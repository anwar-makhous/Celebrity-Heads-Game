export const TOTAL_ROUNDS = 3
export const TURN_SECONDS = 60
export const WARNING_SECONDS = 10
export const POOL_MULTIPLIER = 3

// The game is designed for 8 to 13, but the size is not capped at 13.
// Four is the real floor: the guesser's own teammates are the ones who can see
// the name, so every team needs at least two people or nobody can answer.
export const SUGGESTED_MIN = 8
export const SUGGESTED_MAX = 13
export const MIN_TO_START = 4
export const MIN_PER_TEAM = 2
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

// Each round reads its own file from data/: round 1 uses the first file,
// round 2 the second, round 3 the third. The file is shuffled every time, so
// the same file never comes out in the same order twice.
//
// `needed` is one personality per player. If a round's file is too short to
// cover everyone, the others top it up rather than cutting the round short and
// skipping players.
export function pickRoundDeck(decks, roundNumber, usedNames, needed, random = Math.random) {
  const lists = (decks ?? []).filter((d) => Array.isArray(d) && d.length)
  if (!lists.length) return []

  const primary = lists[Math.min(Math.max(roundNumber, 1) - 1, lists.length - 1)]
  const used = new Set(usedNames)
  const fresh = (list) => list.filter((p) => p && p.name && !used.has(p.name))

  const picked = shuffle(fresh(primary), random)
  if (picked.length >= needed) return picked

  const already = new Set(picked.map((p) => p.name))
  const topUp = shuffle(
    fresh(lists.filter((l) => l !== primary).flat()).filter((p) => !already.has(p.name)),
    random,
  )
  const combined = [...picked, ...topUp]
  if (combined.length >= needed) return combined

  // Everything has been shown already. Start the file over rather than leave
  // someone without a turn.
  const names = new Set(combined.map((p) => p.name))
  return [...combined, ...shuffle(primary, random).filter((p) => !names.has(p.name))]
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
