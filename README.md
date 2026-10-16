# gladys-hilo

[Gladys Assistant](https://gladysassistant.com) external integration for
**Hilo**, the smart-home service of Hydro-Québec, live: the **challenges**
("défis", the peak events Hilo manages: announcement, pre-heat, reduction,
recovery, rewards) as sensors and scene triggers, and the Hilo devices
(thermostats, plugs, switches, dimmers, water heater controllers, the smart
meter, weather stations) with their values, their power, an energy index
computed from it, and commands. Unofficial, not affiliated with Hilo or
Hydro-Québec.

User documentation: [docs/fr.md](docs/fr.md) · [docs/en.md](docs/en.md).

> **Work in progress (0.1, not published to the store yet).** Built from the
> protocol of python-hilo 2026.10.1 and the Home Assistant integration
> dvd-dev/hilo 2026.10.2, tested with answers and hub messages shaped after
> their recorded ones, not yet with a real Hilo account. Feedback and bug
> reports are welcome in the
> [GitHub issues](https://github.com/LM1LC3N7/gladys-hilo/issues).

**With [Gladys-Hydro-Quebec](https://github.com/LM1LC3N7/Gladys-Hydro-Quebec)**:
that one reads the Hydro-Québec customer account (billed 30-minute
consumption a day late, Rate D / Flex D contracts and costs, Hydro-Québec's
peak events); this one reads the Hilo home (live power, device control, Hilo's
challenges and rewards). Keep Hydro-Québec's consumption as the main meter
and attach the Hilo device indexes under it (docs: "With the Hydro-Québec
integration").

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (HiloApp)
                                   ├─ src/client.js        session, REST, GraphQL (api / platform.hiloenergie.com)
                                   ├─ src/hubs.js          DeviceHub + ChallengeHub (@microsoft/signalr)
                                   ├─ src/subscription.js  GraphQL onAnyDeviceUpdated (Server-Sent Events)
                                   ├─ src/auth.js          PKCE, sign-in page, pasted address (pure)
                                   ├─ src/inventory.js     device list and readings -> plain objects (pure)
                                   ├─ src/devices.js       -> Gladys devices and states (pure)
                                   ├─ src/challenges.js    challenge book, phases, scene events (pure)
                                   ├─ src/energy.js        power -> kWh index
                                   ├─ src/publisher.js     300 states/min, scene events queued
                                   └─ src/store.js         session, PKCE, indexes, events told (/data)
```

- **Sign-in**: OAuth 2 authorization code with PKCE on Hilo's Azure AD B2C
  (`connexion.hiloenergie.com`, policy `B2C_1A_SIGN_IN`), the client id of
  python-hilo / Home Assistant. Hilo only redirects to the address registered
  for that client (`https://my.home-assistant.io/redirect/oauth`), so the
  manifest field is an `account_link`: "Connect" opens the Hilo page, the user
  pastes the address of the last page in the **Finish the sign-in** action,
  the code is exchanged (verifier and state kept in `/data` 30 minutes). The
  access token is renewed 5 minutes before its end with the refresh token
  (rotated by B2C, always stored); a refused one stops everything until a new
  sign-in (status, `sign_in_needed` scene event), never retried in a loop.
- **Location**: `GET /Automation/v1/api/Locations` (first location, as Home
  Assistant); the location URN comes from the token claim
  `urn:com:hiloenergie:profile:location_hilo_id`.
- **DeviceHub** (`https://api.hiloenergie.com/DeviceHub`, negotiate with the
  bearer and the API Management key, redirected to Azure SignalR Service):
  `SubscribeToLocation(locationId)` → `DeviceListInitialValuesReceived` (the
  device list, published to Discovery), `DevicesValuesReceived` /
  `GatewayValuesReceived` (values), `DeviceAdded`.
- **Digital twin** (`https://platform.hiloenergie.com/api/digital-twin/v3/graphql`):
  `getLocation` at start and after each stream reconnection, then the
  `onAnyDeviceUpdated` subscription as Server-Sent Events; persisted queries
  (SHA-256 of python-hilo's exact documents), their text sent on
  `PersistedQueryNotFound`; a stream silent for 180 s is restarted.
- **ChallengeHub** (no API Management key: python-hilo gets a 401 with it):
  `SubscribeToChallengeList` + `SubscribeToEventList` → the challenge lists,
  `ChallengeAdded` / `EventAdded`; per challenge `SubscribeToChallenge` +
  `SubscribeToEventCH` or `SubscribeToEventFlex` (details, report);
  `Request…ConsumptionUpdate` every 5 minutes during pre-heat and reduction.
  The phase is computed from the published times (a timer at each change and
  a clock every minute), as python-hilo's `Event.state`.
- **Season rewards**: `GET /challenge/v1/api/Locations/{urn}/seasonssummary`
  then `…/rates/{plan}/seasons/{season}/events?periodId=…` (every 6 hours and
  after a challenge), pre-season events left out like Home Assistant.
- **Commands**: `PUT /Automation/v1/api/Locations/{id}/Devices/{id}/Attributes`
  with `{ "TargetTemperature": 21 }`, `{ "OnOff": true }`,
  `{ "Intensity": 0.42 }`, only for the attributes Hilo lists as settable.
- **Devices**: `ext:<selector>:device:<hardware identifier>` (MAC / Zigbee
  EUI, the Hilo id without one) and `ext:<selector>:challenges:<location id>`.
- **Energy**: an `energy-sensor/index` per device with a power, integrating
  the power (held until the next reading) while the live link is up; kept in
  `/data`.
- **States** through `publishChangedStates` (unchanged ones skipped, sent
  again every 30 minutes); commanded values through `publishStates`; scene
  events queued, one per transition, never twice (what was told is kept in
  `/data`).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/hilo.js` holds the device list, hub messages, GraphQL answers
and challenge messages adapted from dvd-dev/hilo's test fixtures and
python-hilo's `doc/` JSON (2025-26 season and legacy), and made-up tokens
carrying the claims python-hilo reads; `test/helpers/fakeHilo.js` serves them
behind the transport (token endpoint, REST, GraphQL, SSE stream) and a
SignalR connection stand-in. `test/app.test.js` runs the whole integration on
the SDK's fake Gladys: sign-in, devices, values, commands, a challenge from
announcement to end, energy, a lost session.

## Credits

The protocol comes from these projects (MIT), read as documentation; the
client is ported in Node with what Gladys needs, nothing is used as a
dependency:

- [python-hilo](https://github.com/dvd-dev/python-hilo) 2026.10.1 (MIT,
  Copyright (c) 2020-2024 David Vallee Delisle): hosts, OAuth client id,
  scope and PKCE rules, API Management key, REST paths, hub methods and
  messages, the GraphQL documents (copied byte for byte in
  `src/graphqlQueries.js`: they are persisted queries), the value mapping of
  the digital twin, the challenge phases, the season rewards, the recorded
  JSON messages.
- [dvd-dev/hilo](https://github.com/dvd-dev/hilo) 2026.10.2 (MIT, Copyright
  (c) 2021 dvd-dev), the Home Assistant integration: the sign-in exchange,
  the hub subscriptions per rate, the challenge handling, the device classes,
  the challenge lock, the energy computed from the power, the device list
  fixture.
- [homebridge-hilo](https://github.com/SanterreJo/homebridge-hilo) 7.0.2
  (MIT, Jonathan Santerre), read only: the same sign-in used outside Home
  Assistant, the command bodies, the DeviceHub through @microsoft/signalr.
- [@microsoft/signalr](https://www.npmjs.com/package/@microsoft/signalr)
  10.0.11 (MIT, Microsoft), the only runtime dependency besides the SDK: the
  SignalR client (negotiate, Azure redirect, WebSocket).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release only.

## License

Apache-2.0. Hilo and Hydro-Québec are trademarks of their owners; this project
is not affiliated with Hilo or Hydro-Québec. The parts ported from
python-hilo and dvd-dev/hilo keep their MIT notice (see the file headers).
