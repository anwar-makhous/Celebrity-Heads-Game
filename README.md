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

Open the page in separate browser profiles or windows — each one is a separate player. Two
players is enough to start.

To see all three views at once you need **four**: two on each team. With only two players a team
is a single person, so when it is their turn nobody is left to read the name out, and the app
says so.

Refreshing keeps your place: your identity is remembered in that browser's local storage.

## The personalities

[src/personalities.json](src/personalities.json) is a plain list read by the server at startup:

```json
[
  { "name": "Cristiano Ronaldo", "fact": "Portuguese footballer; five Ballon d'Or awards, all-time record international goalscorer" }
]
```

Add or remove freely, then restart the server. Two rules for `fact`: keep it short, and never let
it contain any part of the person's name — it would give the answer away.

Each round draws `players x 3` names that have not come up yet, so nobody repeats in one session.
13 players needs at least 39 entries; the file ships with 196.

## Layout

- `server/` — the game state machine and a small HTTP + server-sent-events server, no dependencies.
- `shared/` — pure game rules used by both sides.
- `src/` — the React client.

Teams sit side by side at 768px and wider, and stack on a phone with the timer above them.
