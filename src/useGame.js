import { useCallback, useEffect, useRef, useState } from 'react'

const TOKEN_KEY = 'celebrityHeads:token'
const NAME_KEY = 'celebrityHeads:name'

const readStore = (key) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null // private windows and blocked site data
  }
}
const writeStore = (key, value) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* the session just will not survive a refresh */
  }
}

export function useGame() {
  const [state, setState] = useState(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  // The token is this browser's proof of who it is. It never leaves here
  // except in requests to the game server.
  const [token, setToken] = useState(() => readStore(TOKEN_KEY))
  const [retry, setRetry] = useState(0)
  const savedName = useRef(readStore(NAME_KEY) ?? '')

  // Clocks on two machines rarely agree, so count down against the server's
  // idea of "now". Only re-measure on a real drift, otherwise small network
  // jitter makes the number bounce around.
  const skew = useRef(0)
  const skewSet = useRef(false)
  // Never let an older snapshot overwrite a newer one. A slow POST reply can
  // land after the push that superseded it.
  const applied = useRef(0)
  const turnKey = useRef(null)

  const apply = useCallback((next) => {
    if (!next || typeof next.version !== 'number') return
    if (next.version < applied.current) return
    applied.current = next.version
    const drift = next.serverNow - Date.now()
    if (!skewSet.current || Math.abs(drift - skew.current) > 1000) {
      skew.current = drift
      skewSet.current = true
    }
    turnKey.current = next.turnKey ?? null
    setState(next)
  }, [])

  useEffect(() => {
    const query = token ? `?token=${encodeURIComponent(token)}` : ''
    const source = new EventSource(`/api/events${query}`)
    let reopen = null

    source.onopen = () => setConnected(true)
    source.onmessage = (event) => {
      try {
        setConnected(true)
        apply(JSON.parse(event.data))
      } catch {
        /* ignore a malformed frame */
      }
    }
    source.onerror = () => {
      setConnected(false)
      // EventSource retries by itself while CONNECTING, but once it gives up
      // and closes, nothing brings it back unless we rebuild it.
      if (source.readyState === EventSource.CLOSED && !reopen) {
        reopen = setTimeout(() => setRetry((n) => n + 1), 2000)
      }
    }
    return () => {
      if (reopen) clearTimeout(reopen)
      source.close()
    }
  }, [token, retry, apply])

  const post = useCallback(
    async (path, body = {}) => {
      setError(null)
      setBusy(true)
      try {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...body, token }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          setError(data.error ?? 'Something went wrong.')
          return null
        }
        apply(data.state)
        return data
      } catch {
        setError('Lost the connection to the game. Is the server still running?')
        return null
      } finally {
        setBusy(false)
      }
    },
    [token, apply],
  )

  // Actions that end or advance a turn say WHICH turn they meant, so a slow or
  // repeated press cannot land on the next one.
  const postTurn = useCallback(
    (path, body = {}) => post(path, { ...body, turnKey: turnKey.current }),
    [post],
  )

  const join = useCallback(
    async (name) => {
      const data = await post('/api/join', { name })
      if (data?.player?.token) {
        writeStore(TOKEN_KEY, data.player.token)
        writeStore(NAME_KEY, data.player.name)
        savedName.current = data.player.name
        applied.current = 0
        setToken(data.player.token)
      }
      return data
    },
    [post],
  )

  // A stale error should not sit on screen forever once things are moving again.
  useEffect(() => {
    if (!error) return
    const id = setTimeout(() => setError(null), 6000)
    return () => clearTimeout(id)
  }, [error])

  // Leaving gives up this browser's identity, so the join screen comes back.
  const leave = useCallback(async () => {
    const data = await post('/api/leave')
    if (data) {
      try {
        localStorage.removeItem(TOKEN_KEY)
      } catch {
        /* nothing to clear */
      }
      applied.current = 0
      setState(null)
      setToken(null)
    }
    return data
  }, [post])

  const actions = {
    join,
    dismissError: useCallback(() => setError(null), []),
    leave,
    endGame: useCallback(() => post('/api/end-game'), [post]),
    start: useCallback(() => post('/api/start'), [post]),
    gotIt: useCallback(() => postTurn('/api/end-turn', { outcome: 'correct' }), [postTurn]),
    skip: useCallback(() => postTurn('/api/end-turn', { outcome: 'skip' }), [postTurn]),
    nextPlayer: useCallback(() => postTurn('/api/next-player'), [postTurn]),
    nextRound: useCallback(() => post('/api/next-round'), [post]),
    playAgain: useCallback(() => post('/api/play-again'), [post]),
  }

  return { state, connected, error, busy, actions, skew, savedName: savedName.current }
}
