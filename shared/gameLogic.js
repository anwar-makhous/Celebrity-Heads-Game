export const TOTAL_ROUNDS = 3
export const TURN_SECONDS = 60
export const WARNING_SECONDS = 10
export const POOL_MULTIPLIER = 3

// The game is designed for 8 to 13, but nothing is enforced: two players is
// enough to start so the app can be tested with a couple of browser windows.
export const SUGGESTED_MIN = 8
export const SUGGESTED_MAX = 13
export const MIN_TO_START = 2
// A backstop against a join flood eating memory; far above any real game.
export const MAX_PLAYERS_HARD_CAP = 40
export const MAX_NAME_LENGTH = 24

export function shuffle(list, random = Math.random) {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

// New arrivals go to whichever team is smaller, so the split stays even as
// people trickle in and the lobby can show real teams before the game starts.
export function teamForNextPlayer(players) {
  const a = players.filter((p) => p.team === 'A').length
  const b = players.filter((p) => p.team === 'B').length
  return b < a ? 'B' : 'A'
}

// One turn per player, alternating A, B, A, B ... A team that runs out of
// players is skipped, so an odd headcount still gives everyone exactly one go.
export function buildTurnOrder(players) {
  const a = players.filter((p) => p.team === 'A')
  const b = players.filter((p) => p.team === 'B')
  const order = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) order.push(a[i].id)
    if (i < b.length) order.push(b[i].id)
  }
  return order
}

// A round's pool is (players x 3) personalities that have not been shown yet
// this session. Only one per turn is ever revealed; the rest go back in the hat.
export function shuffleAndSelectPersonalities(deck, usedNames, playerCount, random = Math.random) {
  const used = new Set(usedNames)
  const unshown = deck.filter((p) => !used.has(p.name))
  return shuffle(unshown, random).slice(0, Math.max(1, playerCount * POOL_MULTIPLIER))
}

export function secondsLeft(deadline, now = Date.now()) {
  if (!deadline) return 0
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}

export function cleanName(raw) {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
}
