# TODO — Hilo v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/fr.md`, `docs/en.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  the claim is post #224 of /t/10385; the main session posts one recap there,
  with a link to each repo, once the batch is published.

## Status

- [x] **Milestone 1 — core** (2026-10-16): sign-in (OAuth 2 code + PKCE on
      Hilo's B2C, `account_link` "Connect", address of the last page pasted in
      "Finish the sign-in", session in `/data`, refresh 5 min before the end,
      refused refresh = stop + status + `sign_in_needed`), first location,
      DeviceHub and ChallengeHub through @microsoft/signalr (subscriptions
      sent again at each connection, backoff 5 s → 5 min), GraphQL digital
      twin (`getLocation` + `onAnyDeviceUpdated` over SSE, persisted queries,
      180 s watchdog), devices (thermostats, plugs, load and water heater
      controllers, lights, meter, weather stations) with power and an energy
      index integrated from it, commands (setpoint, on/off, brightness),
      unreachable badges, the challenges device (status text, phase flags,
      reduction times, rewards, consumption), scene triggers
      `challenge_announced`, `challenge_phase_started`, `challenge_ended`,
      `sign_in_needed`, anticipation phase, challenge lock, season rewards,
      "Test the connection", "Sign out", docs fr/en. Tested against fixtures
      shaped after python-hilo and dvd-dev/hilo only.
- [ ] **Milestone 2 — real account**: run against a real Hilo account and
      compare with the app (see "To check on a real account"); turn what
      differs into fixtures (anonymized); fix.
- [ ] **Milestone 3 — more**: thermostat mode (`ThermostatMode`,
      `allowedModes`) and floor thermostat limits, color and color
      temperature of the bulbs (Hue/Saturation/ColorTemperature), the 24 V
      thermostats' cooling, Hilo notifications (`/Notifications`), Hilo
      weather, the Flex D cost of a challenge (`baselineCost`, `kWhCost`),
      several locations, a scene action to opt a device out of a challenge if
      the API allows it.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, GHCR package public (the main session does it).

## To check on a real account

- **Sign-in**: that the B2C page accepts our authorize URL (python-hilo's
  client id, scope and `https://my.home-assistant.io/redirect/oauth`), what
  the my.home-assistant.io page shows to someone without Home Assistant (the
  address must still carry `code` and `state`), that the code exchange
  without scope works as in Home Assistant, the lifetime of the access token
  and of the refresh token, whether B2C rotates it, the answer to a revoked
  or expired one (400 `invalid_grant` + `AADB2C900…` expected).
- **Hubs**: the negotiate answer (`url` + `accessToken` of Azure SignalR
  Service) followed by @microsoft/signalr with the `ocp-apim-subscription-key`
  header on the DeviceHub (and without it on the ChallengeHub); whether the
  hubs close when the Azure token expires; that `send` (no invocation id) is
  enough for the subscriptions (pysignalr sends invocations too); the real
  `DeviceListInitialValuesReceived` (list attributes as arrays?), whether
  `DevicesValuesReceived` still flows now that python-hilo reads the digital
  twin.
- **Digital twin**: that Node's fetch (HTTP/1.1) is accepted where python-hilo
  uses HTTP/2; whether the server knows python-hilo's persisted queries or
  needs the text once; the SSE framing (`event: next` / `complete`),
  keepalive comments.
- **Challenges**: a whole challenge of each rate (CH and Flex D): the order
  of the messages, whether `EventListInitialValuesReceived` lists the
  upcoming ones only, `currentPhase` vs our clock, the consumption messages
  during the reduction (every 5 minutes is Home Assistant's pace), the
  report and its `reward` after the end, the seasons answers (`events` key,
  `periodId`).
- **Commands**: `PUT …/Attributes` answers (200 or 204), the delay before the
  value comes back, `TargetTemperature` as a number (python-hilo sends a
  string through `Climate`, Home Assistant a float), `Intensity` 0..1.
- **Energy**: compare a day of the meter's integrated index with the
  Hydro-Québec consumption of the same day (Gladys-Hydro-Quebec).
- **Devices**: real models of each kind (Sinopé, Mysa, Jasco, Netatmo, the
  `Ccr` load controller), units of `Noise` and `Pressure`, identifiers
  (stable after a re-pairing?).

## Decisions

- **Not a duplicate** (checked 2026-10-16):
  - Gladys core master `0027571e` (2026-10-16): `git grep -i hilo` in
    `server/` and `front/src` finds only the word "philosophy"; no Hilo
    service.
  - Store index (live, 433 entries, generated 2026-10-16T11:15Z) and
    `rejected.json`: no Hilo; the matches are guim31/gladys-heatzy ("hilo
    piloto" in Spanish) and LM1LC3N7/Gladys-Hydro-Quebec. GitHub and the
    forum: no Gladys Hilo integration; guim31/gladys-sinope covers Sinopé's
    own cloud (Neviweb), not Hilo. pierre-gilles listed Hilo among the wanted
    Québec modules (/t/10385 #60); tracker n° 367; claimed in #224.
  - **With Gladys-Hydro-Quebec** (Louis's): it reads the Hydro-Québec customer
    account (billed 30-minute consumption a day late through
    `publishEnergyConsumption`, Rate D / Flex D contract templates and the
    `hq-critical-peaks` calendar, Hydro-Québec's public peak events). This one
    reads the Hilo home. No overlap; this module declares no energy contract
    nor calendar (the calendar key belongs to Gladys-Hydro-Quebec), and the
    docs say which meter is the main one.
- **Reuse** (Louis's rule: reuse maintained work, rewrite dead or
  debt-heavy code), 2026-10-16:
  - npm (`npm search hilo`, `hiloenergie`, `hydro-quebec`, 2026-10-16) has
    no Hilo library, only two Homebridge plugins, neither importable:
    `homebridge-hilo` 7.0.2 (2026-07, MIT, Jonathan Santerre, active) is a
    Homebridge platform (it exports the platform, keeps the refresh token in
    the Homebridge config file, runs an express server on port 8880 for its
    OAuth callback, axios + graphql-ws + jsonwebtoken, challenges removed in
    6.0); `homebridge-hilo-challenge` 0.1.6 (2026-08, MIT) polls the devices'
    `gDState` through GraphQL and guesses the location path. Both were read
    (unpacked, never run) as confirmation of the protocol: the same client
    id and Home Assistant redirect used outside Home Assistant (the plugin
    asks the user to point my.home-assistant.io at its own server), the
    `PUT …/Attributes` bodies, the DeviceHub through @microsoft/signalr, and
    a WebSocket alternative for the GraphQL subscription
    (`wss://platform.hiloenergie.com/api/digital-twin/v3/graphql?access_token=…`,
    graphql-ws) kept in reserve if the SSE stream misbehaves.
  - python-hilo 2026.10.1 (MIT, 15 releases in 12 months) and dvd-dev/hilo
    2026.10.2 (MIT, HACS, very active): the protocol references, read as
    documentation and ported in Node to the minimum Gladys needs (~1,200
    lines in `src/`), with their notices in the file headers; the GraphQL
    documents copied byte for byte (persisted queries are keyed by their
    SHA-256, pinned by `test/graphql.test.js`).
  - **@microsoft/signalr 10.0.11** (MIT, Microsoft, the official client,
    maintained with ASP.NET Core) for the hubs, as the brief asked: 17
    packages (abort-controller, eventsource 2, fetch-cookie/tough-cookie 4,
    node-fetch 2 only loaded without a global fetch, ws 7.5.13), `npm audit
--omit=dev` clean, CommonJS (default import), follows the Azure SignalR
    redirect of the negotiate answer and resets the token factory at each
    start (read in `dist/cjs/HttpConnection.js`). A hand-written SignalR
    JSON client on the SDK's `ws` was the alternative; not needed.
  - HTTP and SSE: Node's fetch, no dependency.
  - Not ported: python-hilo's Firebase installation and Android GCM
    registration (`fb_install`, `android_register`): its token is stored but
    never sent to Hilo in 2026.10.1, and faking an Android device has no use
    for Gladys. To revisit only if a real account shows the hubs need it.
- **Sign-in**: Gladys's `oauth2` field needs the provider to accept the
  Gladys callback page, which Hilo's B2C will not (only the redirect URIs
  registered for python-hilo's client: Home Assistant's
  `https://my.home-assistant.io/redirect/oauth`, the one python-hilo's own
  token script asks to copy back). So the field is an `account_link`
  ("Connect" opens the page, no callback) and the code comes back through the
  `finish_sign_in` action (the address, its query or the bare code; `state`
  checked when present; 30 minutes). PKCE (S256) protects the code: alone it
  is useless. Code exchange and refresh send exactly Home Assistant's fields.
  No probing of Hilo's servers from this environment (refused by the
  sandbox): to confirm on a real account.
- **Live values from two sources** (as Home Assistant 2026.10): the DeviceHub
  (`DevicesValuesReceived`) and the digital twin (`onAnyDeviceUpdated`),
  merged by device; `publishChangedStates` drops the duplicates.
- **Devices**: one per Hilo device that has something to show, external id
  from the hardware identifier (Home Assistant uses it for its unique ids);
  features from the supported attributes, writable only when settable;
  `water-heater/binary` for Cee and Sinopé Calypso, `switch/binary` for
  plugs and `Ccr`, `light/binary` + `light/brightness` for lights,
  `temperature-sensor/probe` for the water temperature, `energy-sensor/power`
  and `energy-sensor/index` (kWh) for every power; the gateway and the
  OneLink smoke detector are left out (nothing but their link). Setpoint
  range from `Min/MaxTempSetpoint` at discovery (5–36 °C otherwise, as
  python-hilo).
- **Energy from the power**: no energy counter in Hilo's API; Home Assistant
  integrates the power ("generate energy meters"). Here: left Riemann sum
  (power held until the next reading, which Hilo pushes on change), only
  while the live link is up, a gap over 2 hours adds nothing, kWh kept in
  `/data` every 5 minutes and at stop. Published as `energy-sensor/index` so
  Gladys derives the 30-minute consumption and the cost
  (`publishEnergyConsumption` is for readings that arrive after the fact,
  which these are not).
- **Challenges**: the book merges every message by id (2025-26 `Event…` and
  legacy `Challenge…` targets, as Home Assistant still subscribes to both);
  a full list removes the upcoming ones it lacks (cancelled); consumption
  messages without id go to the challenge in progress or the next; the rate
  comes from `ratePlan`, else the target (`EventCH…` / `EventFlex…`), else
  the configuration. The phase follows the clock (python-hilo `Event.state`),
  re-evaluated at each phase change (timer) and every minute.
- **Challenge features**: text for the status and the reduction times
  (Québec time, `America/Toronto`, `fr-CA` / `en-CA` formats), four
  `energy-sensor/binary` flags (announced, pre-heat, reduction, recovery) for
  scene conditions rather than one numeric phase without labels,
  `currency/decimal` $ for the rewards, `energy-sensor/energy` kWh for the
  reference and measured consumption.
- **Scene events**: one per transition (announced, each phase forward,
  ended), what was told kept in `/data` (40 challenges) so a restart never
  fires twice; a phase missed while stopped fires once if still running; a
  challenge first seen after its end is history (nothing). The optional
  anticipation phase is Home Assistant's "appreciation" phase, in hours
  before the pre-heat.
- **Challenge lock**: Home Assistant's option, refusing setpoint changes from
  Gladys during the reduction (dashboard and scenes alike).
- **One location**: the first, as python-hilo (`get_location_ids` takes
  `[0]`).
- **No polling**: everything is pushed; the REST calls are the locations at
  start, the commands and the seasons every 6 hours.
