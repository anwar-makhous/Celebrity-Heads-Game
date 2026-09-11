# Celebrity Heads Game

A team guessing game for a call. **Everyone opens the page on their own device** — that is what
makes the hidden name work: the person guessing and the opposing team never receive the answer,
only the guesser's own teammates do.

## Run it

```bash
npm install
npm start          # builds the app and serves everything on http://localhost:3001
```

Everyone on the same network opens `http://<your-machine-ip>:3001`. On Linux, `hostname -I`
gives you the address.

For development with hot reload:

```bash
npm run dev        # game server on 3001, Vite on http://localhost:5173
```

`npm run dev` runs both processes and prefixes their output with `[server]` and `[vite]`.
Set `PORT` to move the game server (`PORT=4000 npm start`).

## Deploy on Cloudflare Workers

This project deploys as a **Cloudflare Worker**, not as a Cloudflare Pages project. The Worker
serves the Vite build from `dist/`; requests under `/api/*` are sent to one SQLite-backed Durable
Object named `GameRoom`. That object is the single shared game room, stores the game snapshot,
keeps the SSE streams, and uses a Durable Object alarm for the turn deadline.

```bash
npm install
npm run build
npm run deploy
```

The commands above use the explicit `wrangler` development dependency and
[`wrangler.jsonc`](wrangler.jsonc). Do **not** use `npx wrangler deploy`, and do not point
Wrangler at `vite.config.js`.

For a local production-topology check (Worker, assets, Durable Object, and local SQLite state):

```bash
npm run cf:dev
```

### Cloudflare dashboard setup

1. Use a Cloudflare account on the Workers Free plan and run `wrangler login` once in your own
   terminal.
2. Deploy with the commands above. The first deploy creates the `GameRoom` SQLite Durable Object
   namespace through the `v1` migration in `wrangler.jsonc`; do not create a binding manually in
   the dashboard.
3. Open the generated `workers.dev` URL, or add a custom domain in **Workers & Pages →
   celebrity-heads-game → Settings → Domains & Routes** after the first deploy.
4. If you already made a Pages project for this app, do not use it as the production site: it has
   no role in this Worker deployment. Remove its custom domain or delete the project after the
   Worker URL is verified, so only one deployment is public.

There are no secrets, variables, bindings, paid services, or `PORT` settings to configure. The
configuration routes `/api/*` to the Worker first and has Workers static assets serve all other
requests with an SPA fallback.

### Free-tier and production notes

- Workers Free supports the SQLite Durable Object configured here. The game uses one object, so
  every player at this Worker URL shares the same room and state survives object eviction and
  Worker deployments.
- SSE streams keep the object active. This is appropriate for a small game room, but Cloudflare's
  free Durable Object allowance is finite; if the daily limit is exhausted, requests fail until
  the daily reset rather than generating a charge. Review current Cloudflare limits before using
  it for a continuously occupied public game.
- Durable Object alarms make the 60-second turn expiration survive restarts. Cloudflare can
  deliver an alarm late during a platform failure or maintenance, so the countdown is normally
  60 seconds but can occasionally reveal a little late.
- `npm run dev`, `npm run server`, and `npm start` still use the original Node server and its
  in-memory state. `npm run cf:dev` uses the Cloudflare implementation and writes only local
  throwaway state under `.wrangler/`, which is gitignored.

## How a game goes

1. Everyone opens the page and types their name. Teams fill up evenly as people join.
2. Anyone presses **Start Game** — one person is enough, it starts for everybody.
3. A name appears. Only the **guesser's teammates** see it. The guesser asks yes/no questions
   out loud on the call; their teammates answer yes or no.
4. When the team gets it, someone **on that team** presses **Got it! Show the answer**, or
   **Skip, no point**. Either way the name and its fact appear for everyone.
5. Nothing moves on its own. **Anyone** can press **Next Player** once you have all read it.
6. Three rounds. Every player guesses once per round, alternating between teams.

Each turn still has a 60 second clock. If it runs out the turn ends with no point and the answer
is shown — the reveal then waits for the button like any other turn. If you want the clock gone,
delete the `TURN_SECONDS` deadline in [server/game.js](server/game.js).

## Who sees the name

| | While a turn is running | On the reveal |
| --- | --- | --- |
| The guesser | hidden | sees it |
| The guesser's teammates | **sees it** | sees it |
| The opposing team | hidden | sees it |

This is enforced on the server, not in the browser. The name is simply left out of the data sent
to anyone who is not allowed to know it, so opening devtools does not help.

## Testing it yourself

Open the page in separate browser profiles or windows — each one is a separate player.

You need **four** to start, two per team. That is not an arbitrary floor: the guesser's own
teammates are the people who can see the name, so a team of one leaves nobody able to answer.
Four also happens to be exactly what you need to see all three views at once — guesser, teammate,
and opposing team.

Refreshing keeps your place: your identity is remembered in that browser's local storage.

## The personalities

The decks live in `data/`, one file per round:

| File | Used for |
| --- | --- |
| `data/round1.json` | Round 1 |
| `data/round2.json` | Round 2 |
| `data/round3.json` | Round 3 |

So put the easy names in `round1.json` and the hard ones in `round3.json`. Any further files in
`data/` are ignored. Each round shuffles its own file, so the order is different every game.

Each file is a plain list:

```json
[
  { "name": "Cristiano Ronaldo", "fact": "Portuguese footballer; five Ballon d'Or awards, all-time record international goalscorer" }
]
```

Two rules for `fact`: keep it short, and never let it contain any part of the person's name, or it
gives the answer away.

A file needs at least one entry per player (13 players means 13 entries). If a file is short the
other rounds' files top it up rather than skipping anyone's turn.

**The files are bundled at build time**, because Cloudflare Workers have no filesystem. After
editing anything in `data/`, run `npm run build` again (and redeploy) for the change to show up.
Locally, `npm run server` re-reads them on restart.

## Leaving and closing a game

The `...` button on the game screen has two options:

- **Leave the game** - just you. Your turn is dropped and everyone else carries on. If you were
  the one guessing, the turn ends with no point and everybody sees the answer.
- **Close the game for everyone** - ends the game for the whole room and sends everybody back to
  the lobby. It asks you to confirm first, since it throws the scores away.

## Layout

- `server/` — the game state machine and the Node HTTP + server-sent-events server used locally.
- `shared/` — pure game rules used by both sides.
- `src/` — the React client.
- `worker/` — the Cloudflare Worker and Durable Object used in production.

Teams sit side by side at 768px and wider, and stack on a phone with the timer above them.
