# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15). Its only
other runtime dependency is `@microsoft/signalr` (the Hilo hubs); HTTP and
Server-Sent Events go through Node's fetch. It signs in to the Hilo account
(OAuth 2 + PKCE, the code pasted back by the user), follows the first location
live (DeviceHub, ChallengeHub, GraphQL digital twin), turns the Hilo devices
and the challenges into Gladys devices, states and scene events, and sends the
commands. Unofficial, not affiliated with Hilo or Hydro-Québec.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js              SDK bootstrap only
src/handlers.js       every SDK handler -> the app (shared with the tests)
src/app.js            HiloApp: sign-in, online/offline, hubs and stream wiring,
                      readings -> states, commands, challenges, clock, buttons
src/client.js         the account: session (refresh, one retry on 401), REST,
                      GraphQL (persisted queries), hub URLs and headers
src/http.js           the only HTTP access (fetch, timeout, SSE body)
src/hubs.js           one SignalR hub kept alive (@microsoft/signalr)
src/subscription.js   the GraphQL subscription over SSE (watchdog, backoff)
src/auth.js           PKCE, sign-in URL, pasted address, token forms, JWT (pure)
src/inventory.js      device list and readings -> plain objects (pure)
src/devices.js        -> Gladys devices, states, commands (pure)
src/challenges.js     the challenge book, phases, scene events (pure)
src/energy.js         power -> kWh indexes
src/publisher.js      states within 300/min, scene events queued
src/store.js          /data/hilo-state.json: session, PKCE, indexes, events told
src/config.js         config_schema normalized
src/constants.js      hosts, paths, keys, hub methods and targets, limits
src/graphqlQueries.js python-hilo's GraphQL documents, byte for byte
src/i18n.js           runtime texts, device, feature and phase names (en/fr)
test/fixtures/        shaped after python-hilo's doc JSON and dvd-dev/hilo's fixtures
test/helpers/         a fake Hilo (transport, SSE, SignalR connections), timers
```

## Rules

- **External ids are forever**: device = `device:<hardware identifier>`
  (`deviceKey()`), `challenges:<location id>`; feature = `<device>:<role>`
  (`temperature`, `probe-temperature`, `setpoint`, `humidity`, `power`,
  `energy`, `state`, `light`, `brightness`, `water-heater`, `co2`, `noise`,
  `pressure`, `battery`; challenges: `status`, `scheduled`, `preheat`,
  `reduction`, `recovery`, `reduction-start`, `reduction-end`,
  `expected-reward`, `last-reward`, `season-reward`, `baseline`,
  `consumption`). Never change how they are built.
- Manifest keys (`hilo_account`, `rate_plan`, `anticipation_hours`,
  `challenge_lock`, `language`, the actions, the scene triggers with their
  fields and variables, the phase values `anticipation`, `preheat`,
  `reduction`, `recovery`) are frozen: users store them in scenes.
- `src/graphqlQueries.js` is generated from python-hilo: never reformat its
  strings by hand (`test/graphql.test.js` pins their SHA-256).
- **Sign-in**: never log or put in a status message the tokens, the code or
  the verifier. A refused refresh token stops everything and waits for the
  user (no retry loop). Never add a call outside `HiloClient` / `Hub` /
  `GraphqlSubscription`.
- Scene events go through `publisher.pushSceneEvent`, decided by
  `challengeEvents()` from what `/data` says was already told: one event per
  transition, never twice, never one caused by a Gladys command.
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network. Gladys rate limits: 300 states/min, 300 scene
  events/min.
- Tests never touch the network: the transport and the hub connections are
  injected.
- Code, comments, README in English; `docs/fr.md` and `docs/en.md` kept in
  sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
