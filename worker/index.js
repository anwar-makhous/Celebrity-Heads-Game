// One file per round, bundled at build time. Workers have no filesystem, so
// these are static imports: add a file to data/ and rebuild to pick it up.
import round1 from '../data/round1.json'
import round2 from '../data/round2.json'
import round3 from '../data/round3.json'

const decks = [round1, round2, round3]
import * as G from '../server/game.js'

const GAME_STORAGE_KEY = 'game'
const ROOM_NAME = 'default'
const MAX_BODY_BYTES = 64 * 1024
const encoder = new TextEncoder()

// The public Worker deliberately has no game state. Every API request goes to
// the one named Durable Object, which serializes game mutations and owns all
// live SSE streams for this deployed game.
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      const id = env.GAME_ROOM.idFromName(ROOM_NAME)
      return env.GAME_ROOM.get(id).fetch(request)
    }

    // Static paths normally bypass this handler because wrangler.jsonc runs
    // the Worker first only for /api/*. This fallback keeps the deployment
    // correct if that routing policy is later broadened.
    return env.ASSETS.fetch(request)
  },
}

export class GameRoom {
  constructor(state) {
    this.state = state
    this.clients = new Set() // { writer, token, closed, writes }
    this.game = null

    // Never serve a request until the persisted snapshot is loaded. The deck
    // is build-time data, so it is reattached rather than stored on every
    // mutation.
    this.ready = this.state.blockConcurrencyWhile(async () => {
      const saved = await this.state.storage.get(GAME_STORAGE_KEY)
      if (saved) {
        // Drop any deck shape an older deployment persisted, then reattach the
        // current build-time decks.
        const { deck: legacy, decks: stale, ...rest } = saved
        this.game = { ...rest, decks }
      } else {
        this.game = G.createGame(decks)
      }
      // Handles a snapshot created by an early pre-deployment build.
      if (!Number.isInteger(this.game.nextId) || this.game.nextId < 1) {
        this.game.nextId = this.game.players.length + 1
      }
    })
  }

  async fetch(request) {
    await this.ready
    try {
      return await this.handle(request)
    } catch (err) {
      console.error('request failed:', err?.message ?? err)
      return json(500, { error: 'server error' })
    }
  }

  // Durable Object alarms survive eviction, unlike the Node server's timer.
  // Cloudflare may deliver an alarm late, but never before its scheduled time.
  async alarm() {
    await this.ready
    if (G.timeUp(this.game)) {
      await this.settle()
    } else {
      await this.scheduleTurnEnd()
    }
  }

  async handle(request) {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/api/events' && request.method === 'GET') {
      return this.openEvents(request, url)
    }

    if (request.method !== 'POST') return json(405, { error: 'method not allowed' })

    let body
    try {
      body = await readBody(request)
    } catch (err) {
      return json(400, { error: err.message })
    }

    // A token always identifies the caller. The state in every response is
    // rendered for that one token, so an action cannot expose another
    // player's hidden answer.
    const token = body.token ?? null
    const run = async (fn) => {
      const result = fn() ?? {}
      if (result.error) return json(400, { error: result.error })
      await this.settle()
      return json(200, { ok: true, state: G.viewFor(this.game, token) })
    }

    switch (path) {
      case '/api/join': {
        const result = G.join(this.game, body.name)
        if (result.error) return json(400, { error: result.error })
        await this.settle()
        return json(200, {
          ok: true,
          player: {
            id: result.player.id,
            token: result.player.token,
            name: result.player.name,
            team: result.player.team,
          },
          state: G.viewFor(this.game, result.player.token),
        })
      }
      case '/api/rename':
        return run(() => G.rename(this.game, token, body.name))
      case '/api/leave':
        return run(() => G.leave(this.game, token))
      case '/api/start':
        return run(() => G.start(this.game, token))
      case '/api/end-turn':
        return run(() =>
          G.endTurn(
            this.game,
            token,
            body.outcome === 'correct' ? 'correct' : 'skip',
            turnKey(body),
          ),
        )
      case '/api/next-player':
        return run(() => G.nextPlayer(this.game, token, turnKey(body)))
      case '/api/next-round':
        return run(() => G.nextRound(this.game, token))
      case '/api/play-again':
        return run(() => G.playAgain(this.game, token))
      case '/api/end-game':
        return run(() => G.endGame(this.game, token))
      default:
        return json(404, { error: 'no such endpoint' })
    }
  }

  openEvents(request, url) {
    const token = url.searchParams.get('token') || null
    const { readable, writable } = new IdentityTransformStream()
    const client = {
      writer: writable.getWriter(),
      token,
      closed: false,
      writes: Promise.resolve(),
    }

    this.clients.add(client)
    // Both signals are needed here. The request signal catches a browser
    // disconnect at the DO, and writer.closed catches stream cancellation as
    // it propagates back from the public Worker.
    const disconnect = () => { void this.dropClient(client) }
    request.signal.addEventListener('abort', disconnect, { once: true })
    void client.writer.closed.then(disconnect, disconnect)

    this.push(client, ': connected\n\n')
    if (token && G.setOnline(this.game, token, true)) {
      // The stream must be returned before awaiting a writer write. Storage
      // work is safe to continue here, and the queued broadcast follows the
      // connection comment in its stream.
      void this.settle().catch((err) => console.error('event stream setup failed:', err))
    } else {
      this.pushState(client)
    }
    void this.keepAlive(client)

    return new Response(readable, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    })
  }

  pushState(client) {
    this.push(client, `data: ${JSON.stringify(G.viewFor(this.game, client.token))}\n\n`)
  }

  broadcast() {
    for (const client of this.clients) this.pushState(client)
  }

  // Queue writes per stream. Awaiting a writer before returning its Response
  // would deadlock the first SSE frame, so broadcasts intentionally enqueue.
  push(client, message) {
    if (client.closed) return
    client.writes = client.writes
      .then(() => client.writer.write(encoder.encode(message)))
      .catch(() => this.dropClient(client))
  }

  async keepAlive(client) {
    try {
      while (!client.closed) {
        await scheduler.wait(20_000)
        if (!client.closed) this.push(client, ': ping\n\n')
      }
    } catch (err) {
      if (!client.closed) console.error('SSE heartbeat failed:', err)
    }
  }

  async dropClient(client) {
    if (client.closed) return
    client.closed = true
    this.clients.delete(client)
    try {
      await client.writer.close()
    } catch {
      // A cancelled or errored stream is already closed.
    }

    // Do not mark a player away while another tab with the same token is
    // still receiving events.
    if (client.token && ![...this.clients].some((other) => other.token === client.token)) {
      if (G.setOnline(this.game, client.token, false)) await this.settle()
    }
  }

  async settle() {
    await this.state.storage.put(GAME_STORAGE_KEY, withoutDeck(this.game))
    await this.scheduleTurnEnd()
    this.broadcast()
  }

  async scheduleTurnEnd() {
    if (this.game.phase === 'playing' && this.game.turnEndsAt) {
      await this.state.storage.setAlarm(this.game.turnEndsAt)
    } else {
      await this.state.storage.deleteAlarm()
    }
  }
}

// The decks come from the bundle on every boot, so they never go into storage.
function withoutDeck(game) {
  const { deck: legacy, decks: ignored, ...snapshot } = game
  return snapshot
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

async function readBody(request) {
  if (!request.body) return {}
  const reader = request.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new Error('body too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  if (!chunks.length) return {}
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  let parsed
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error('invalid JSON body')
  }
  // "null", "[]", and numbers are valid JSON, but endpoints only accept a
  // plain object just like the Node server did.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('body must be a JSON object')
  }
  return parsed
}

function turnKey(body) {
  const key = body.turnKey
  if (!key || typeof key !== 'object') return null
  const round = Number(key.round)
  const turnIndex = Number(key.turnIndex)
  if (!Number.isInteger(round) || !Number.isInteger(turnIndex)) return null
  return { round, turnIndex }
}
