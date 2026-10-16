// -----------------------------------------------------------------------------
// Hilo hosts, paths and app constants (as python-hilo 2026.10.1, pyhilo/const.py,
// MIT License, Copyright (c) 2020-2024 David Vallee Delisle), the keys of the
// manifest and the limits of Gladys.
// -----------------------------------------------------------------------------

// Sign-in: Azure AD B2C of Hilo, authorization code with PKCE (S256). The
// client id is the one python-hilo and the Home Assistant integration use;
// Hilo only accepts the redirect URI registered for it, the Home Assistant
// "my" link, so the user copies the address of that page back into Gladys.
export const AUTH = {
  host: 'connexion.hiloenergie.com',
  authorizePath: '/HiloDirectoryB2C.onmicrosoft.com/B2C_1A_SIGN_IN/oauth2/v2.0/authorize',
  tokenPath: '/HiloDirectoryB2C.onmicrosoft.com/B2C_1A_SIGN_IN/oauth2/v2.0/token',
  clientId: '1ca9f585-4a55-4085-8e30-9746a65fa561',
  scope:
    'openid https://HiloDirectoryB2C.onmicrosoft.com/hiloapis/user_impersonation offline_access',
  redirectUri: 'https://my.home-assistant.io/redirect/oauth',
  // A sign-in started more than this long ago is forgotten (B2C codes live minutes).
  pendingTtl: 30 * 60 * 1000,
};

// The REST API (Azure API Management) and its subscription key, the hubs and
// the GraphQL "digital twin".
export const API = {
  host: 'api.hiloenergie.com',
  subscriptionKey: '20eeaedcb86945afa3fe792cea89b8bf',
  locations: '/Automation/v1/api/Locations',
  deviceAttributes: (locationId, deviceId) =>
    `/Automation/v1/api/Locations/${locationId}/Devices/${deviceId}/Attributes`,
  seasons: (urn) => `/challenge/v1/api/Locations/${urn}/seasonssummary`,
  seasonEvents: (urn, ratePlan, season, periodId) =>
    `/challenge/v1/api/Locations/${urn}/rates/${encodeURIComponent(ratePlan)}/seasons/` +
    `${encodeURIComponent(season)}/events?periodId=${encodeURIComponent(periodId)}`,
  deviceHub: '/DeviceHub',
  challengeHub: '/ChallengeHub',
  graphqlHost: 'platform.hiloenergie.com',
  graphqlPath: '/api/digital-twin/v3/graphql',
};

// The JWT claim that holds the location URN (`urn:hilo:crm:…`).
export const URN_CLAIM = 'urn:com:hiloenergie:profile:location_hilo_id';

// Hub methods (as the Home Assistant integration calls them, October 2026).
export const HUB_METHODS = {
  subscribeToLocation: 'SubscribeToLocation',
  subscribeToChallengeList: 'SubscribeToChallengeList',
  subscribeToEventList: 'SubscribeToEventList',
  subscribeToChallenge: 'SubscribeToChallenge',
  subscribeToEventCH: 'SubscribeToEventCH',
  subscribeToEventFlex: 'SubscribeToEventFlex',
  requestChallengeConsumption: 'RequestChallengeConsumptionUpdate',
  requestEventCHConsumption: 'RequestEventCHConsumptionUpdate',
  requestEventFlexConsumption: 'RequestEventFlexConsumptionUpdate',
};

// Messages the hubs send. The 2025-26 season renamed the challenges "events"
// and split them by rate (CH = winter credits of Rate D, Flex = Flex D).
export const DEVICE_TARGETS = {
  list: ['DeviceListInitialValuesReceived'],
  added: ['DeviceAdded'],
  values: ['DevicesValuesReceived', 'GatewayValuesReceived'],
  ignored: ['DeviceListUpdatedValuesReceived', 'DevicesListChanged', 'DeviceDeleted', 'Heartbeat'],
};

export const CHALLENGE_TARGETS = {
  list: ['ChallengeListInitialValuesReceived', 'EventListInitialValuesReceived'],
  listUpdate: ['ChallengeListUpdatedValuesReceived', 'EventListUpdatedValuesReceived'],
  added: ['ChallengeAdded', 'EventAdded'],
  details: [
    'ChallengeDetailsInitialValuesReceived',
    'EventCHDetailsInitialValuesReceived',
    'EventFlexDetailsInitialValuesReceived',
    'ChallengeDetailsUpdatedValuesReceived',
    'ChallengeDetailsUpdated',
    'EventCHDetailsUpdatedValuesReceived',
    'EventFlexDetailsUpdatedValuesReceived',
  ],
  consumption: [
    'ChallengeConsumptionUpdatedValuesReceived',
    'EventCHConsumptionUpdatedValuesReceived',
    'EventFlexConsumptionUpdatedValuesReceived',
  ],
  ignored: ['Heartbeat'],
};

// Rate plans of the challenges: `ratePlan` of the events, and the config.
export const RATE_PLANS = {
  auto: 'auto',
  ch: 'CH',
  flex: 'Flex',
};

// The phases of a challenge, in order. `anticipation` is ours: the configured
// number of hours before the pre-heat (Home Assistant's "appreciation").
export const PHASES = ['anticipation', 'preheat', 'reduction', 'recovery'];

// Numeric value of the "phase" feature (documented in docs/*.md, never change).
export const PHASE_CODES = {
  none: 0,
  scheduled: 1,
  anticipation: 2,
  preheat: 3,
  reduction: 4,
  recovery: 5,
};

// Hilo device types (python-hilo HILO_DEVICE_TYPES + Home Assistant classes)
// -> the kind of Gladys device we build.
export const DEVICE_KINDS = {
  Thermostat: 'thermostat',
  FloorThermostat: 'thermostat',
  Thermostat24V: 'thermostat',
  MysaThermostat: 'thermostat',
  TCC24V: 'thermostat',
  SinopeThermostat: 'thermostat',
  SinopeFloorThermostat: 'thermostat',
  Sinope24V: 'thermostat',
  Outlet: 'outlet',
  Ccr: 'switch',
  Cee: 'water-heater',
  SinopeWaterHeater: 'water-heater',
  LightSwitch: 'light',
  LightDimmer: 'light',
  WhiteBulb: 'light',
  ColorBulb: 'light',
  Meter: 'meter',
  ChargingPoint: 'charger',
  IndoorWeatherStation: 'weather',
  OutdoorWeatherStation: 'weather',
  Gateway: 'gateway',
  SmokeDetector: 'smoke',
  Tracker: 'ignored',
};

// Models python-hilo turns into outlets (Jasco Enbrighten under the Hilo brand).
export const JASCO_OUTLETS = ['42405', '43094', '43095', '43100', '45853'];

// The keys of the manifest (frozen: users store them in scenes).
export const ACTIONS = {
  FINISH_SIGN_IN: 'finish_sign_in',
  TEST_CONNECTION: 'test_connection',
  SIGN_OUT: 'sign_out',
};

export const ACCOUNT_FIELD = 'hilo_account';

export const SCENE_TRIGGERS = {
  CHALLENGE_ANNOUNCED: 'challenge_announced',
  PHASE_STARTED: 'challenge_phase_started',
  CHALLENGE_ENDED: 'challenge_ended',
  SIGN_IN_NEEDED: 'sign_in_needed',
};

// Gladys values (server/utils/constants.js, not exported by the SDK).
export const GLADYS = {
  on: 1,
  off: 0,
};

// The time zone of Hydro-Québec, for the local times shown to the user.
export const TIME_ZONE = 'America/Toronto';

export const LIMITS = {
  statesPerMinute: 280,
  sceneEventsPerMinute: 280,
  statesPerRequest: 100,
  queuedEvents: 500,
  // Challenges kept after their end (the result arrives later).
  endedChallengeKeep: 36 * 60 * 60 * 1000,
  // Ended challenges remembered so a restart fires nothing twice.
  rememberedChallenges: 40,
};

export const TIMINGS = {
  flushInterval: 1000,
  stateHeartbeat: 30 * 60 * 1000,
  // Phase clock and energy integration.
  tick: 60 * 1000,
  // The access token is renewed this long before its end.
  tokenMargin: 5 * 60 * 1000,
  // Reconnection of the hubs and of the GraphQL stream: 5 s doubling to 5 min.
  reconnectBase: 5 * 1000,
  reconnectMax: 5 * 60 * 1000,
  // A GraphQL stream without any byte for that long is restarted (python-hilo: 180 s).
  sseKeepalive: 180 * 1000,
  // The device list must arrive this long after the subscription.
  deviceListTimeout: 30 * 1000,
  // Consumption of a challenge asked again every 5 min during pre-heat and reduction.
  consumptionRequest: 5 * 60 * 1000,
  // Season rewards read again every 6 hours (and after a challenge).
  seasonsRefresh: 6 * 60 * 60 * 1000,
  // Energy indexes saved to /data at most this often.
  energySave: 5 * 60 * 1000,
  // Power older than this is not integrated (hubs down, device silent).
  energyMaxGap: 2 * 60 * 60 * 1000,
  requestTimeout: 20 * 1000,
};
