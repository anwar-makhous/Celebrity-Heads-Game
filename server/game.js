import {
  MAX_PLAYERS_HARD_CAP,
  MIN_TO_START,
  TOTAL_ROUNDS,
  TURN_SECONDS,
  buildTurnOrder,
  cleanName,
  shuffleAndSelectPersonalities,
  teamForNextPlayer,
} from '../shared/gameLogic.js'

// Keep the Node server's historical process-local sequence as a fallback.
// Durable Object snapshots also carry nextId so an eviction cannot reuse one.
let nextId = 1

export function createGame(deck) {
  return {
    deck,
    // The Node server kept this counter in module memory. Durable Object
    // state can be evicted and reloaded, so it belongs in the game snapshot.
    nextId: 1,
    version: 1,
    phase: 'lobby', // lobby | playing | reveal | roundEnd | gameEnd
    players: [], // { id, name, team, online }
    round: 0,
    usedNames: [],
    pool: [],
    turnOrder: [],
    turnIndex: 0,
    current: null, // { name, fact }
    scoreA: 0,
    scoreB: 0,
    turnEndsAt: null,
    lastOutcome: null, // correct | skip | timeout
    lastScorer: null,
  }
}

const touch = (game) => { game.version += 1 }

// id is public and goes out in every broadcast. token is the secret that proves
// you are that player, and is handed to that browser alone. Keeping them apart
// is what stops one player acting as another to read the answer.
const byId = (game, id) => game.players.find((p) => p.id === id) ?? null
const byToken = (game, token) =>
  (token ? game.players.find((p) => p.token === token) : null) ?? null

export function guesserId(game) {
  if (game.phase !== 'playing' && game.phase !== 'reveal') return null
  return game.turnOrder[game.turnIndex] ?? null
}

/* ------------------------------------------------------------------ joining */

export function join(game, rawName) {
  // Lobby only. Letting someone join mid turn would put them on the guessing
  // team and hand them the answer, which is exactly how a guesser could cheat
  // with a second browser window.
  if (game.phase !== 'lobby') {
    return { error: 'A game is already running. You can join as soon as this one finishes.' }
  }
  if (game.players.length >= MAX_PLAYERS_HARD_CAP) {
    return { error: `This game is full (${MAX_PLAYERS_HARD_CAP} players).` }
  }
  const name = cleanName(rawName)
  if (!name) return { error: 'Enter your name to join.' }

  const taken = game.players.some((p) => p.name.toLowerCase() === name.toLowerCase())
  if (taken) return { error: 'Someone already joined with that name. Try another.' }

  const player = {
    id: `p${game.nextId ?? nextId}`,
    // Web Crypto is available in both Node 24 and Cloudflare Workers. Do not
    // import node:crypto here: this game module is shared by the Worker.
    token: globalThis.crypto.randomUUID(),
    name,
    team: teamForNextPlayer(game.players),
    online: true,
  }
  game.nextId = (game.nextId ?? nextId) + 1
  nextId = Math.max(nextId, game.nextId)
  game.players.push(player)
  touch(game)
  return { player }
}

export function rename(game, token, rawName) {
  const player = byToken(game, token)
  if (!player) return { error: 'unknown player' }
  const name = cleanName(rawName)
  if (!name) return { error: 'Enter your name.' }
  if (game.players.some((p) => p.id !== player.id && p.name.toLowerCase() === name.toLowerCase())) {
    return { error: 'Someone already joined with that name. Try another.' }
  }
  player.name = name
  touch(game)
  return { player }
}

export function setOnline(game, token, online) {
  const player = byToken(game, token)
  if (!player || player.online === online) return false
  player.online = online
  touch(game)
  return true
}

// Only allowed from the lobby, so a game in progress cannot lose a player and
// break its turn order.
export function leave(game, token) {
  if (game.phase !== 'lobby') return { error: 'You can only leave before the game starts.' }
  const me = byToken(game, token)
  if (!me) return { error: 'unknown player' }
  const before = game.players.length
  game.players = game.players.filter((p) => p.id !== me.id)
  if (game.players.length === before) return { error: 'unknown player' }
  // Rebalance so the teams stay even after someone drops out.
  const rebalanced = []
  for (const p of game.players) {
    rebalanced.push({ ...p, team: teamForNextPlayer(rebalanced) })
  }
  game.players = rebalanced
  touch(game)
  return {}
}

/* ------------------------------------------------------------------- rounds */

function startRound(game, roundNumber) {
  const playing = game.players
  game.round = roundNumber
  game.turnOrder = buildTurnOrder(playing)
  game.turnIndex = 0
  game.pool = shuffleAndSelectPersonalities(game.deck, game.usedNames, playing.length)
  // If the deck cannot cover a turn per player any more, start a fresh cycle
  // rather than silently cutting the round short and skipping people.
  if (game.pool.length < game.turnOrder.length) {
    game.usedNames = []
    game.pool = shuffleAndSelectPersonalities(game.deck, game.usedNames, playing.length)
  }
  game.current = game.pool[0] ?? null
  if (game.current) game.usedNames.push(game.current.name)
  game.lastOutcome = null
  game.lastScorer = null
  const ready = game.current && game.turnOrder.length
  game.turnEndsAt = ready ? Date.now() + TURN_SECONDS * 1000 : null
  game.phase = ready ? 'playing' : 'gameEnd'
  touch(game)
}

export function canStart(game) {
  if (game.phase !== 'lobby') return false
  const a = game.players.filter((p) => p.team === 'A').length
  const b = game.players.filter((p) => p.team === 'B').length
  return game.players.length >= MIN_TO_START && a >= 1 && b >= 1
}

export function start(game, token) {
  if (!byToken(game, token)) return { error: 'Join the game first.' }
  if (!canStart(game)) {
    return { error: `You need at least ${MIN_TO_START} players, with someone on each team.` }
  }
  game.scoreA = 0
  game.scoreB = 0
  game.usedNames = []
  startRound(game, 1)
  return {}
}

/* -------------------------------------------------------------------- turns */

// Ends the current turn and shows the name and fact to everyone. outcome is
// 'correct' (the team got it), 'skip', or 'timeout'.
// `expected` pins the action to a specific turn. Without it a press that was
// delayed on the network, or a double press, could land on the NEXT turn and
// score a second point for a name nobody guessed.
export function endTurn(game, token, outcome, expected) {
  if (game.phase !== 'playing') return { error: 'That turn has already ended.' }
  if (
    expected &&
    (expected.round !== game.round || expected.turnIndex !== game.turnIndex)
  ) {
    return { error: 'That turn has already ended.' }
  }
  const guesser = guesserId(game)
  const actor = token ? byToken(game, token) : null
  // 'timeout' comes from the server's own clock, so it has no actor. Every
  // player initiated outcome must come from a real player.
  if (outcome !== 'timeout' && !actor) return { error: 'Join the game first.' }
  const currentTeam = byId(game, guesser)?.team ?? null

  if (outcome === 'correct') {
    // Only the guessing team can award itself a point.
    if (!actor || actor.team !== currentTeam) {
      return { error: 'Only the team that is guessing can mark it correct.' }
    }
    if (currentTeam === 'A') game.scoreA += 1
    else game.scoreB += 1
    game.lastScorer = currentTeam
  } else if (outcome === 'skip') {
    // Strictly the guessing team's call. There is no deadlock to rescue: the
    // 60 second clock always ends the turn on its own.
    if (actor.team !== currentTeam) {
      return { error: 'Only the team that is guessing can skip.' }
    }
    game.lastScorer = null
  } else {
    game.lastScorer = null
  }

  game.lastOutcome = outcome
  game.turnEndsAt = null
  game.phase = 'reveal'
  touch(game)
  return {}
}

// The manual "Next Player" step. Any player may press it.
export function nextPlayer(game, token, expected) {
  if (!byToken(game, token)) return { error: 'Join the game first.' }
  if (game.phase !== 'reveal') return { error: 'Nothing to advance right now.' }
  if (expected && (expected.round !== game.round || expected.turnIndex !== game.turnIndex)) {
    return { error: 'Someone already moved the game on.' }
  }
  const nextIndex = game.turnIndex + 1
  const upNext = game.turnOrder[nextIndex] ? game.pool[nextIndex] : null

  if (!game.turnOrder[nextIndex] || !upNext) {
    game.phase = game.round >= TOTAL_ROUNDS ? 'gameEnd' : 'roundEnd'
    game.current = null
    game.turnEndsAt = null
    touch(game)
    return {}
  }

  game.turnIndex = nextIndex
  game.current = upNext
  if (!game.usedNames.includes(upNext.name)) game.usedNames.push(upNext.name)
  game.lastOutcome = null
  game.lastScorer = null
  game.turnEndsAt = Date.now() + TURN_SECONDS * 1000
  game.phase = 'playing'
  touch(game)
  return {}
}

export function nextRound(game, token) {
  if (!byToken(game, token)) return { error: 'Join the game first.' }
  if (game.phase !== 'roundEnd') return { error: 'The round is not over.' }
  startRound(game, game.round + 1)
  return {}
}

export function playAgain(game, token) {
  if (!byToken(game, token)) return { error: 'Join the game first.' }
  if (game.phase !== 'gameEnd') return { error: 'The game is not over.' }
  game.phase = 'lobby'
  game.round = 0
  game.usedNames = []
  game.pool = []
  game.turnOrder = []
  game.turnIndex = 0
  game.current = null
  game.scoreA = 0
  game.scoreB = 0
  game.turnEndsAt = null
  game.lastOutcome = null
  game.lastScorer = null
  touch(game)
  return {}
}

// Fired by the server when the 60 seconds run out.
export function timeUp(game) {
  if (game.phase !== 'playing') return false
  const result = endTurn(game, null, 'timeout')
  return !result?.error
}

/* --------------------------------------------------------------- redaction */

// Who is allowed to know the name while a turn is running:
//   the guesser            -> no, that is the whole game
//   the guesser's team     -> yes, they answer the questions
//   the opposing team      -> no, they play along and find out at the reveal
// At the reveal everyone sees it.
export function canSeeName(game, token) {
  // Resolve the viewer FIRST. A connection without a valid token is not a
  // player and never gets the answer, not even on the reveal.
  const viewer = byToken(game, token)
  if (!viewer) return false
  if (game.phase === 'reveal') return true
  if (game.phase !== 'playing') return false
  const guesser = byId(game, guesserId(game))
  if (!guesser) return false
  if (viewer.id === guesser.id) return false
  return viewer.team === guesser.team
}

export function viewFor(game, token) {
  const you = byToken(game, token)
  const gid = guesserId(game)
  const guesser = byId(game, gid)
  const visible = canSeeName(game, token)

  // Nobody on the guessing team is left to read the name out.
  const teamMates = guesser
    ? game.players.filter((p) => p.team === guesser.team && p.id !== guesser.id)
    : []

  return {
    version: game.version,
    phase: game.phase,
    serverNow: Date.now(),
    you: you ? { id: you.id, name: you.name, team: you.team } : null,
    inThisRound: you ? game.turnOrder.includes(you.id) : false,
    // Public fields only. Never spread a player object here, or the secret
    // token would go out to everybody.
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      online: p.online,
      isGuesser: p.id === gid,
      playsThisRound: game.turnOrder.includes(p.id),
    })),
    round: game.round,
    totalRounds: TOTAL_ROUNDS,
    turnNumber: game.turnOrder.length ? game.turnIndex + 1 : 0,
    turnsPerRound: game.turnOrder.length,
    currentTeam: guesser?.team ?? null,
    guesser: guesser ? { id: guesser.id, name: guesser.name, team: guesser.team } : null,
    scoreA: game.scoreA,
    scoreB: game.scoreB,
    // The name simply is not in the payload unless this player may see it.
    personality: visible && game.current ? { name: game.current.name } : null,
    // The fact is only ever part of the reveal, and only for a real player.
    fact: visible && game.phase === 'reveal' && game.current ? game.current.fact : null,
    canSeeName: visible,
    nobodyCanSeeName: game.phase === 'playing' && teamMates.length === 0,
    noTeamMateOnline:
      game.phase === 'playing' && teamMates.length > 0 && !teamMates.some((p) => p.online),
    turnEndsAt: game.turnEndsAt,
    lastOutcome: game.lastOutcome,
    lastScorer: game.lastScorer,
    deckSize: game.deck.length,
    // What this turn is, so an action can say which turn it meant.
    turnKey: { round: game.round, turnIndex: game.turnIndex },
    can: {
      start: canStart(game) && !!you,
      score: game.phase === 'playing' && !!you && !!guesser && you.team === guesser.team,
      skip: game.phase === 'playing' && !!you && !!guesser && you.team === guesser.team,
      advance: game.phase === 'reveal' && !!you,
      nextRound: game.phase === 'roundEnd' && !!you,
      playAgain: game.phase === 'gameEnd' && !!you,
    },
  }
}
