import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as G from './game.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(HERE, '..')
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.PORT ?? 3001)

const deck = JSON.parse(await readFile(join(ROOT, 'src', 'personalities.json'), 'utf8'))
const game = G.createGame(deck)

/* -------------------------------------------------------- connected clients */

const clients = new Set() // { res, token }

function pushTo(client) {
  try {
    client.res.write(`data: ${JSON.stringify(G.viewFor(game, client.token))}\n\n`)
  } catch {
    dropClient(client)
  }
}

function dropClient(client) {
  if (client.beat) clearInterval(client.beat)
  client.beat = null
  clients.delete(client)
}

// Every client gets its own redacted view, so the name never reaches a browser
// that is not allowed to know it.
function broadcast() {
  for (const client of clients) pushTo(client)
}

/* ------------------------------------------------------------- turn deadline */

let turnTimer = null
let scheduledFor = null

function rescheduleTurnEnd() {
  if (game.turnEndsAt === scheduledFor) return
  if (turnTimer) clearTimeout(turnTimer)
  turnTimer = null
  scheduledFor = game.turnEndsAt
  if (game.phase !== 'playing' || !game.turnEndsAt) return
  turnTimer = setTimeout(() => {
    turnTimer = null
    scheduledFor = null
    if (G.timeUp(game)) {
      rescheduleTurnEnd()
      broadcast()
    }
  }, Math.max(0, game.turnEndsAt - Date.now()))
}

function settle() {
  rescheduleTurnEnd()
  broadcast()
}

/* --------------------------------------------------------------- http helpers */

const sendJson = (res, code, body) => {
  const text = JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('body too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  let parsed
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('invalid JSON body')
  }
  // "null", "[]", "3" are all valid JSON. Only take a plain object.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('body must be a JSON object')
  }
  return parsed
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

async function serveStatic(req, res, urlPath) {
  // normalize + prefix check keeps ../ out of the served tree
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return sendJson(res, 400, { error: 'bad path' })
  }
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, '')
  let file = join(DIST, rel)
  if (!file.startsWith(DIST)) return sendJson(res, 403, { error: 'forbidden' })
  try {
    const info = await stat(file)
    if (info.isDirectory()) file = join(file, 'index.html')
  } catch {
    file = join(DIST, 'index.html') // single page app fallback
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
      'content-length': body.length,
    })
    res.end(body)
  } catch {
    sendJson(res, 404, {
      error: 'Not built yet. Run "npm run build", or use "npm run dev" for the dev server.',
    })
  }
}

/* ---------------------------------------------------------------- endpoints */

async function handle(req, res) {
  let url
  try {
    // A malformed Host header would otherwise throw before anything else runs.
    url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
  } catch {
    try { url = new URL(req.url, 'http://localhost') } catch { return sendJson(res, 400, { error: 'bad request' }) }
  }
  const path = url.pathname

  if (!path.startsWith('/api/')) return serveStatic(req, res, path)

  // Server sent events: one long lived stream per player.
  if (path === '/api/events' && req.method === 'GET') {
    const token = url.searchParams.get('token') || null
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write(': connected\n\n')
    const client = { res, token }
    clients.add(client)
    if (token) { if (G.setOnline(game, token, true)) broadcast() }
    pushTo(client)

    client.beat = setInterval(() => {
      try { res.write(': ping\n\n') } catch { dropClient(client) }
    }, 20000)

    req.on('close', () => {
      dropClient(client)
      // Only mark offline when this player has no other stream open, so an
      // extra tab closing does not make them look gone.
      if (token && ![...clients].some((c) => c.token === token)) {
        if (G.setOnline(game, token, false)) broadcast()
      }
    })
    return
  }

  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })

  let body
  try {
    body = await readBody(req)
  } catch (err) {
    return sendJson(res, 400, { error: err.message })
  }
  // The token identifies the caller. Every response is rendered for that token
  // alone, so an action can never hand back another player's view.
  const token = body.token ?? null

  const run = (fn) => {
    const result = fn() ?? {}
    if (result.error) return sendJson(res, 400, { error: result.error })
    settle()
    return sendJson(res, 200, { ok: true, state: G.viewFor(game, token) })
  }

  switch (path) {
    case '/api/join': {
      const result = G.join(game, body.name)
      if (result.error) return sendJson(res, 400, { error: result.error })
      settle()
      // The token goes to this one browser and nowhere else.
      return sendJson(res, 200, {
        ok: true,
        player: {
          id: result.player.id,
          token: result.player.token,
          name: result.player.name,
          team: result.player.team,
        },
        state: G.viewFor(game, result.player.token),
      })
    }
    case '/api/rename':
      return run(() => G.rename(game, token, body.name))
    case '/api/leave':
      return run(() => G.leave(game, token))
    case '/api/start':
      return run(() => G.start(game, token))
    case '/api/end-turn':
      return run(() =>
        G.endTurn(game, token, body.outcome === 'correct' ? 'correct' : 'skip', turnKey(body)),
      )
    case '/api/next-player':
      return run(() => G.nextPlayer(game, token, turnKey(body)))
    case '/api/next-round':
      return run(() => G.nextRound(game, token))
    case '/api/play-again':
      return run(() => G.playAgain(game, token))
    default:
      return sendJson(res, 404, { error: 'no such endpoint' })
  }
}

// Which turn the caller thought it was acting on, if it said.
function turnKey(body) {
  const k = body.turnKey
  if (!k || typeof k !== 'object') return null
  const round = Number(k.round)
  const turnIndex = Number(k.turnIndex)
  if (!Number.isInteger(round) || !Number.isInteger(turnIndex)) return null
  return { round, turnIndex }
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('request failed:', err?.message ?? err)
    try {
      if (!res.headersSent) sendJson(res, 500, { error: 'server error' })
      else res.end()
    } catch { /* the socket is already gone */ }
  })
})

// Last line of defence: never let a stray rejection or a client socket error
// take the process down and end the game for everybody.
process.on('unhandledRejection', (err) => console.error('unhandled rejection:', err?.message ?? err))
process.on('uncaughtException', (err) => console.error('uncaught exception:', err?.message ?? err))
server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})

server.listen(PORT, () => {
  console.log(`Celebrity Heads server on http://localhost:${PORT}`)
  console.log(`Deck: ${deck.length} personalities`)
  console.log('Share your machine\'s address on the network so everyone can join.')
})
