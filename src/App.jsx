import { useEffect, useState } from 'react'
import { useGame } from './useGame.js'
import {
  SUGGESTED_MAX,
  SUGGESTED_MIN,
  WARNING_SECONDS,
  MAX_NAME_LENGTH,
  secondsLeft,
} from '../shared/gameLogic.js'

const RING = 'focus-visible:ring-4 focus-visible:ring-slate-500 focus-visible:outline-none'
const PRIMARY = `w-full rounded-xl bg-slate-900 py-5 text-[24px] font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 ${RING}`

const teamStyle = {
  A: {
    panel: 'bg-blue-50 border-blue-200',
    active: 'border-blue-600 shadow-lg',
    text: 'text-blue-800',
    button: 'bg-blue-600 hover:bg-blue-700',
    chip: 'bg-blue-600 text-white',
  },
  B: {
    panel: 'bg-red-50 border-red-200',
    active: 'border-red-600 shadow-lg',
    text: 'text-red-800',
    button: 'bg-red-600 hover:bg-red-700',
    chip: 'bg-red-600 text-white',
  },
}

export default function App() {
  const { state, connected, error, busy, actions, skew, savedName } = useGame()

  if (!state) {
    return (
      <Centered>
        <h1 className="text-[32px] font-bold text-slate-900">Celebrity Heads Game</h1>
        <p className="mt-3 text-[18px] text-slate-600">
          {connected ? 'Loading the game...' : 'Connecting to the game server...'}
        </p>
      </Centered>
    )
  }

  const banner = <Banner connected={connected} error={error} />

  if (!state.you) {
    return <JoinScreen onJoin={actions.join} busy={busy} banner={banner} savedName={savedName} />
  }
  if (state.phase === 'lobby') {
    return <Lobby state={state} actions={actions} busy={busy} banner={banner} />
  }
  if (state.phase === 'roundEnd' || state.phase === 'gameEnd') {
    return <BetweenScreen state={state} actions={actions} busy={busy} banner={banner} />
  }
  return <TurnScreen state={state} actions={actions} busy={busy} skew={skew} banner={banner} />
}

/* ---------------------------------------------------------------- chrome */

function Centered({ children }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-xl rounded-2xl border-2 border-slate-200 bg-white p-6 text-center sm:p-8">
        {children}
      </div>
    </div>
  )
}

function Banner({ connected, error }) {
  if (connected && !error) return null
  return (
    <div aria-live="polite" className="mb-4 space-y-2">
      {!connected ? (
        <p className="rounded-lg bg-amber-100 px-4 py-3 text-[16px] font-semibold text-amber-900">
          Reconnecting to the game server...
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-red-100 px-4 py-3 text-[16px] font-semibold text-red-900">
          {error}
        </p>
      ) : null}
    </div>
  )
}

// Leaving is a normal thing to do, closing the game for everyone is not, so
// both live behind the dots rather than sitting on the screen as big buttons.
function GameMenu({ state, actions, busy }) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setConfirming(false) } }
    const onClick = (e) => { if (!e.target.closest?.('[data-game-menu]')) { setOpen(false); setConfirming(false) } }
    window.addEventListener('keydown', onKey)
    window.addEventListener('click', onClick)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('click', onClick) }
  }, [open])

  return (
    <div className="relative" data-game-menu>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Game options"
        onClick={() => { setOpen((v) => !v); setConfirming(false) }}
        className={`h-11 w-11 rounded-lg border-2 border-slate-300 bg-white text-[20px] font-bold text-slate-700 hover:bg-slate-100 ${RING}`}
      >
        &#8943;
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-72 rounded-xl border-2 border-slate-200 bg-white p-2 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); actions.leave() }}
            disabled={busy}
            className={`w-full rounded-lg px-4 py-3 text-left text-[16px] font-semibold text-slate-800 hover:bg-slate-100 disabled:text-slate-400 ${RING}`}
          >
            Leave the game
            <span className="block text-[14px] font-normal text-slate-600">
              Just you. Everyone else carries on.
            </span>
          </button>

          {state.can?.endGame ? (
            confirming ? (
              <div className="mt-1 rounded-lg bg-red-50 p-3">
                <p className="text-[15px] font-semibold text-red-900">
                  Close the game for everybody?
                </p>
                <p className="mt-1 text-[14px] text-red-900">
                  Scores are lost and everyone goes back to the lobby.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setOpen(false); setConfirming(false); actions.endGame() }}
                    disabled={busy}
                    className={`flex-1 rounded-lg bg-red-600 px-3 py-2 text-[15px] font-bold text-white hover:bg-red-700 ${RING}`}
                  >
                    Yes, close it
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className={`flex-1 rounded-lg border-2 border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-700 hover:bg-slate-100 ${RING}`}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                role="menuitem"
                onClick={() => setConfirming(true)}
                disabled={busy}
                className={`mt-1 w-full rounded-lg px-4 py-3 text-left text-[16px] font-semibold text-red-800 hover:bg-red-50 disabled:text-slate-400 ${RING}`}
              >
                Close the game for everyone
                <span className="block text-[14px] font-normal text-red-800">
                  Ends this game and sends everybody back to the lobby.
                </span>
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------- join */

function JoinScreen({ onJoin, busy, banner, savedName }) {
  const [name, setName] = useState(savedName)

  const submit = (event) => {
    event.preventDefault()
    if (name.trim()) onJoin(name)
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-xl rounded-2xl border-2 border-slate-200 bg-white p-6 sm:p-8">
        {banner}
        <h1 className="text-[32px] leading-tight font-bold text-slate-900 sm:text-[40px]">
          Celebrity Heads Game
        </h1>
        <p className="mt-2 text-[18px] text-slate-600">
          Everyone on the call opens this page and puts their name in. When you are all in,
          anyone can press start.
        </p>

        <label htmlFor="name" className="mt-8 block text-[18px] font-semibold text-slate-700">
          What is your name?
        </label>
        <input
          id="name"
          autoFocus
          autoComplete="off"
          maxLength={MAX_NAME_LENGTH}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Anwar"
          className="mt-2 h-14 w-full rounded-xl border-2 border-slate-300 px-4 text-[24px] font-bold text-slate-900 focus:border-blue-600 focus:ring-4 focus:ring-blue-200 focus:outline-none"
        />

        <button type="submit" disabled={busy || !name.trim()} className={`mt-6 ${PRIMARY}`}>
          {busy ? 'Joining...' : "I'm in"}
        </button>
        <p className="mt-6 text-[16px] text-slate-600">
          You get put on a team automatically, and the teams are kept even.
        </p>
      </form>
    </div>
  )
}

/* ------------------------------------------------------------------ lobby */

function Lobby({ state, actions, busy, banner }) {
  const teamA = state.players.filter((p) => p.team === 'A')
  const teamB = state.players.filter((p) => p.team === 'B')
  const count = state.players.length

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-3xl rounded-2xl border-2 border-slate-200 bg-white p-6 sm:p-8">
        {banner}
        <h1 className="text-[32px] leading-tight font-bold text-slate-900 sm:text-[40px]">
          Who is playing?
        </h1>
        <p className="mt-2 text-[18px] text-slate-600">
          {count} {count === 1 ? 'person' : 'people'} in so far. You are{' '}
          <strong className={teamStyle[state.you.team].text}>
            {state.you.name}, Team {state.you.team}
          </strong>
          .
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Roster title="Team A" side="A" players={teamA} youId={state.you.id} />
          <Roster title="Team B" side="B" players={teamB} youId={state.you.id} />
        </div>

        {count < SUGGESTED_MIN ? (
          <p className="mt-6 text-[16px] text-slate-600">
            The game is built for {SUGGESTED_MIN} to {SUGGESTED_MAX} players, but you can start
            with as few as two to try it out.
          </p>
        ) : null}

        <button
          type="button"
          onClick={actions.start}
          disabled={busy || !state.can.start}
          className={`mt-6 ${PRIMARY}`}
        >
          {state.can.start ? 'Start Game' : 'Waiting for someone on each team'}
        </button>
        <p className="mt-3 text-[16px] text-slate-600">
          One person pressing this starts the game for everybody.
        </p>

        <button
          type="button"
          onClick={actions.leave}
          disabled={busy}
          className={`mt-6 rounded-lg border-2 border-slate-300 px-4 py-2 text-[16px] font-semibold text-slate-700 hover:bg-slate-100 ${RING}`}
        >
          Leave
        </button>
      </div>
    </div>
  )
}

function Roster({ title, side, players, youId, guesserId }) {
  const theme = teamStyle[side]
  return (
    <div className={`rounded-2xl border-2 p-4 ${theme.panel}`}>
      <h2 className={`text-[24px] font-bold ${theme.text}`}>{title}</h2>
      {players.length === 0 ? (
        <p className="mt-2 text-[16px] text-slate-600">Nobody yet</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {players.map((p) => (
            <li
              key={p.id}
              className={`rounded-full px-3 py-1 text-[14px] font-semibold ${
                p.id === guesserId ? theme.chip : 'bg-white text-slate-700'
              } ${p.online ? '' : 'opacity-50'}`}
            >
              {p.name}
              {p.id === youId ? ' (you)' : ''}
              {p.online ? '' : ' - away'}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------- turn */

function TurnScreen({ state, actions, busy, skew, banner }) {
  const [, tick] = useState(0)
  const revealing = state.phase === 'reveal'

  // local ticking so the countdown moves between server pushes
  const remaining = revealing ? 0 : secondsLeft(state.turnEndsAt, Date.now() + skew.current)

  useEffect(() => {
    if (revealing || !state.turnEndsAt) return
    // The server ends the turn; this interval only keeps the number moving, so
    // there is nothing to do once it is at zero.
    if (remaining <= 0) return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [revealing, state.turnEndsAt, remaining])
  const youAreGuessing = state.guesser?.id === state.you.id
  const yourTeamIsUp = state.currentTeam === state.you.team
  const theme = teamStyle[state.currentTeam ?? 'A']

  return (
    <div className="flex min-h-full flex-col bg-slate-50 px-4 py-2 lg:px-6">
      <header className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3">
        <p className="text-[24px] font-bold text-slate-700">
          Round {state.round}/{state.totalRounds}
        </p>
        <p className="text-[18px] text-slate-600">
          Turn {state.turnNumber} of {state.turnsPerRound}
        </p>
        <div className="flex items-center gap-3">
          <p className="text-[16px] font-semibold text-slate-600">
            You are {state.you.name}, Team {state.you.team}
          </p>
          <GameMenu state={state} actions={actions} busy={busy} />
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl">{banner}</div>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-3 py-2 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)_auto] md:items-stretch">
        <TeamPanel
          side="A"
          state={state}
          actions={actions}
          busy={busy}
          className={`${state.currentTeam === 'A' ? 'order-3' : 'order-4'} md:order-none md:col-start-1 md:row-start-1`}
        />

        <section className="order-1 flex flex-col items-center justify-center rounded-2xl border-2 border-slate-200 bg-white px-4 py-5 text-center md:order-none md:col-start-2 md:row-start-1">
          <p aria-live="polite" aria-atomic="true" className={`text-[18px] font-semibold ${theme.text}`}>
            {youAreGuessing
              ? "It's your turn to guess"
              : `${state.guesser?.name ?? 'Someone'} is guessing for Team ${state.currentTeam}`}
          </p>

          <div className="flex min-h-[132px] w-full items-center justify-center py-2 lg:min-h-[164px]">
            {state.canSeeName && state.personality ? (
              <h1 className="text-[40px] leading-tight font-bold break-words text-slate-900 sm:text-[56px] md:text-[44px] lg:text-[72px]">
                {state.personality.name}
              </h1>
            ) : (
              <h1 className="flex min-h-[132px] w-full items-center justify-center rounded-xl border-4 border-dashed border-slate-300 text-[40px] font-bold tracking-widest text-slate-500 lg:min-h-[164px] lg:text-[72px]">
                <span className="sr-only">Name hidden from you</span>
                <span aria-hidden="true">• • •</span>
              </h1>
            )}
          </div>

          {revealing ? (
            <div className="w-full max-w-2xl" aria-live="polite">
              <p className="text-[18px] leading-relaxed text-slate-600">{state.fact}</p>
              <p className="mt-3 text-[16px] font-semibold text-slate-700">
                {state.lastOutcome === 'correct'
                  ? `Team ${state.lastScorer} got it, one point.`
                  : state.lastOutcome === 'timeout'
                    ? 'Time ran out, no point.'
                    : state.lastOutcome === 'left'
                      ? 'That player left the game, no point.'
                      : 'Skipped, no point.'}
              </p>
              <button
                type="button"
                onClick={actions.nextPlayer}
                disabled={busy || !state.can.advance}
                className={`mt-4 ${PRIMARY}`}
              >
                Next Player
              </button>
              <p className="mt-2 text-[16px] text-slate-600">
                Anyone can press this when you have all read it.
              </p>
            </div>
          ) : (
            <Guidance state={state} youAreGuessing={youAreGuessing} yourTeamIsUp={yourTeamIsUp} />
          )}
        </section>

        <TeamPanel
          side="B"
          state={state}
          actions={actions}
          busy={busy}
          className={`${state.currentTeam === 'B' ? 'order-3' : 'order-4'} md:order-none md:col-start-3 md:row-start-1`}
        />

        <footer className="order-2 rounded-2xl bg-white py-2 text-center md:order-none md:col-span-3 md:row-start-2">
          <p
            role="timer"
            aria-label="Seconds left in this turn"
            className={`text-[64px] leading-none font-bold tabular-nums sm:text-[80px] lg:text-[96px] ${
              revealing ? 'text-slate-400' : remaining < WARNING_SECONDS ? 'text-red-600' : 'text-slate-900'
            }`}
          >
            {remaining}
          </p>
          <p className="mt-1 text-[16px] text-slate-600">seconds left</p>
        </footer>
      </main>
    </div>
  )
}

function Guidance({ state, youAreGuessing, yourTeamIsUp }) {
  if (youAreGuessing) {
    return (
      <div className="text-[16px] text-slate-600">
        <p>Ask your team yes/no questions. They can see the name, you cannot.</p>
        {state.nobodyCanSeeName ? (
          <p className="mt-2 font-semibold text-amber-800">
            Nobody else is on Team {state.you.team} yet, so no one can see the name. Get a
            teammate to join.
          </p>
        ) : null}
        {state.noTeamMateOnline ? (
          <p className="mt-2 font-semibold text-amber-800">
            Your teammates are all offline right now.
          </p>
        ) : null}
      </div>
    )
  }
  if (yourTeamIsUp) {
    return (
      <p className="text-[16px] text-slate-600">
        You can see the name. Answer only <strong>yes</strong> or <strong>no</strong>, and do not
        say it out loud.
      </p>
    )
  }
  return (
    <p className="text-[16px] text-slate-600">
      Team {state.currentTeam} is guessing, so the name is hidden from you too. Play along and you
      will see it on the reveal.
    </p>
  )
}

function TeamPanel({ side, state, actions, busy, className }) {
  const theme = teamStyle[side]
  const players = state.players.filter((p) => p.team === side)
  const isActive = state.currentTeam === side
  const score = side === 'A' ? state.scoreA : state.scoreB
  const yours = state.you.team === side
  const revealing = state.phase === 'reveal'

  return (
    <section
      className={`flex flex-col rounded-2xl border-2 p-4 ${theme.panel} ${isActive ? theme.active : ''} ${className}`}
    >
      <h2 className={`text-[24px] font-bold lg:text-[32px] ${theme.text}`}>
        Team {side}
        {yours ? <span className="text-[16px] font-semibold"> (yours)</span> : null}
      </h2>
      <p className={`text-[32px] font-bold tabular-nums lg:text-[40px] ${theme.text}`}>{score}</p>

      <ul className="mt-3 flex flex-wrap gap-2">
        {players.map((p) => (
          <li
            key={p.id}
            className={`rounded-full px-3 py-1 text-[14px] font-semibold ${
              p.isGuesser ? theme.chip : 'bg-white text-slate-700'
            } ${p.online ? '' : 'opacity-50'}`}
          >
            {p.name}
            {p.id === state.you.id ? ' (you)' : ''}
            {p.isGuesser ? <span className="sr-only"> (guessing now)</span> : null}
            {p.playsThisRound ? '' : ' - next round'}
          </li>
        ))}
      </ul>

      {isActive && !revealing ? (
        <div className="mt-auto flex flex-col gap-2 pt-4">
          <button
            type="button"
            onClick={actions.gotIt}
            disabled={busy || !state.can.score}
            className={`w-full rounded-xl py-4 text-[18px] font-bold text-white lg:py-5 ${theme.button} disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 ${RING}`}
          >
            Got it! Show the answer
          </button>
          <button
            type="button"
            onClick={actions.skip}
            disabled={busy || !state.can.skip}
            className={`w-full rounded-xl border-2 border-slate-300 bg-white py-3 text-[16px] font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 ${RING}`}
          >
            Skip, no point
          </button>
          {!state.can.score ? (
            <p className="text-[14px] text-slate-600">Only Team {side} can press these.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/* ------------------------------------------------------- round and game end */

function BetweenScreen({ state, actions, busy, banner }) {
  const isGameEnd = state.phase === 'gameEnd'
  const winner = state.scoreA === state.scoreB ? null : state.scoreA > state.scoreB ? 'A' : 'B'
  const teamA = state.players.filter((p) => p.team === 'A')
  const teamB = state.players.filter((p) => p.team === 'B')

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-2xl rounded-2xl border-2 border-slate-200 bg-white p-6 text-center sm:p-10">
        {banner}
        <div className="flex justify-end">
          <GameMenu state={state} actions={actions} busy={busy} />
        </div>
        <h1 className="text-[32px] leading-tight font-bold text-slate-900 sm:text-[40px]">
          {isGameEnd ? 'Game Over' : `Round ${state.round}/${state.totalRounds} Complete`}
        </h1>

        <div className="mt-8 grid grid-cols-2 gap-4">
          {['A', 'B'].map((side) => {
            const theme = teamStyle[side]
            const score = side === 'A' ? state.scoreA : state.scoreB
            const size = (side === 'A' ? teamA : teamB).length
            return (
              <div key={side} className={`rounded-2xl border-2 p-6 ${theme.panel}`}>
                <p className={`text-[24px] font-bold lg:text-[32px] ${theme.text}`}>Team {side}</p>
                <p className={`text-[40px] font-bold tabular-nums ${theme.text}`}>{score}</p>
                <p className={`text-[16px] ${theme.text}`}>
                  {size} {size === 1 ? 'player' : 'players'}
                </p>
              </div>
            )
          })}
        </div>

        {isGameEnd ? (
          <p className="mt-8 text-[24px] font-bold text-slate-900 lg:text-[32px]">
            {winner ? `Team ${winner} wins!` : "It's a draw!"}
          </p>
        ) : null}

        <button
          type="button"
          onClick={isGameEnd ? actions.playAgain : actions.nextRound}
          disabled={busy || !(isGameEnd ? state.can.playAgain : state.can.nextRound)}
          className={`mt-8 ${PRIMARY}`}
        >
          {isGameEnd ? 'Play Again' : 'Next Round'}
        </button>
        <p className="mt-3 text-[16px] text-slate-600">Anyone can press this.</p>
      </div>
    </div>
  )
}
