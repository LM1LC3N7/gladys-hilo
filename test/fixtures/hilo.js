// -----------------------------------------------------------------------------
// Hilo answers and hub messages for the tests, adapted (ids shortened, names
// anonymized, a few fields dropped) from:
// - dvd-dev/hilo tests/fixtures/all_devices.json (MIT License, Copyright (c)
//   2021 dvd-dev): the device list, as the DeviceHub sends it
//   (`supportedAttributesList`…);
// - python-hilo 2026.10.1 doc/Challenge(Event) JSON and doc/Old JSONs (MIT
//   License, Copyright (c) 2020-2024 David Vallee Delisle): the challenge
//   messages of the 2025-26 season and the legacy ones;
// - python-hilo pyhilo/graphql.py and pyhilo/api.py docstrings: the GraphQL
//   fields, the seasons answers.
// The tokens are made-up JWTs (unsigned) carrying the claims python-hilo reads.
// -----------------------------------------------------------------------------

const b64 = (object) => Buffer.from(JSON.stringify(object)).toString('base64url');

export const URN = 'urn:hilo:crm:1234567-p2t0x3:0';
export const LOCATION_ID = 4051;
export const EMAIL = 'client@example.com';

export function jwt(claims = {}) {
  return [
    b64({ alg: 'RS256', typ: 'JWT' }),
    b64({
      email: EMAIL,
      exp: 1_800_000_000,
      'urn:com:hiloenergie:profile:location_hilo_id': [URN],
      ...claims,
    }),
    'signature',
  ].join('.');
}

export const tokens = (n = 1) => ({
  access_token: jwt({ n }),
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: `refresh-${n}`,
  refresh_token_expires_in: 1209600,
});

export const locations = [{ id: LOCATION_ID, locationHiloId: URN, name: 'Maison' }];

// DeviceListInitialValuesReceived (dvd-dev/hilo all_devices.json, lists as arrays).
export const deviceList = [
  {
    id: 110999,
    hiloId: 'urn:hilo:philo:0x006baa0000000001-smart_meter:0',
    identifier: '0x006baa0000000001-smart_meter',
    gatewayId: 9999,
    name: 'SmartEnergyMeter',
    type: 'Meter',
    category: 'Other',
    modelNumber: 'SmartMeter',
    locationId: LOCATION_ID,
    provider: 1,
    supportedAttributesList: ['Power', 'ZigbeeChannel', 'LastUpdate', 'Disconnected'],
    settableAttributesList: ['Power'],
    supportedParametersList: [],
  },
  {
    id: 111000,
    hiloId: 'urn:hilo:philo:1a2b3c4d5e6f:0',
    identifier: '1a2b3c4d5e6f',
    gatewayId: 1001,
    name: 'Thermostat salon',
    type: 'Thermostat',
    category: 'Heating',
    modelNumber: 'HT402',
    locationId: LOCATION_ID,
    provider: 1,
    supportedAttributesList: [
      'CurrentTemperature',
      'TargetTemperature',
      'HeatDemand',
      'Heating',
      'Humidity',
      'Power',
      'DrmsState',
      'GdState',
      'MaxTempSetpoint',
      'MinTempSetpoint',
      'Disconnected',
      'Version',
      'ZigbeeVersion',
      'Unpaired',
      'ThermostatMode',
      'ThermostatAllowedModes',
    ],
    settableAttributesList: [
      'TargetTemperature',
      'GrapState',
      'MaxTempSetpoint',
      'MinTempSetpoint',
      'ThermostatMode',
    ],
    supportedParametersList: ['MaxTempSetpoint', 'MinTempSetpoint'],
  },
  {
    id: 111001,
    hiloId: 'urn:hilo:netatmo:a1b1c1d1e1f1:0',
    identifier: 'bc:8e:b2:f2:d2:ca',
    name: 'Extérieur',
    type: 'OutdoorWeatherStation',
    category: 'Safety',
    modelNumber: 'NAModule1_50',
    locationId: LOCATION_ID,
    provider: 2,
    supportedAttributes: 'CurrentTemperature,Humidity,BatteryPercent,Disconnected',
    settableAttributes: '',
  },
  {
    id: 111003,
    hiloId: 'urn:hilo:onelink:d123abc987:0',
    identifier: 'email@test.com',
    name: 'OneLink FirstAlert',
    type: 'SmokeDetector',
    category: 'Safety',
    modelNumber: 'OneLinkFirstAlert',
    locationId: LOCATION_ID,
    provider: 3,
    supportedAttributes: '',
    settableAttributes: '',
  },
  {
    id: 111004,
    hiloId: 'urn:hilo:philo:2a3b4c5d6e7f:0',
    identifier: '2a3b4c5d6e7f',
    name: 'Prise bureau',
    type: 'Outlet',
    category: 'SmartPlug',
    modelNumber: '42405',
    locationId: LOCATION_ID,
    provider: 1,
    supportedAttributesList: ['OnOff', 'Disconnected', 'Power'],
    settableAttributesList: ['OnOff'],
  },
  {
    id: 111006,
    hiloId: 'urn:hilo:philo:4a5b6c7d8e9f:0',
    identifier: '4a5b6c7d8e9f',
    name: 'Chauffe-eau',
    type: 'Cee',
    category: 'Water',
    modelNumber: 'STLO-23',
    locationId: LOCATION_ID,
    provider: 1,
    supportedAttributes:
      'OnOff, Power, Disconnected, DrmsState, GdState, DrmsStateReason, Version, ZigbeeVersion, Unpaired, Heating, AbnormalTemperature, CurrentTemperature, CcrMode, CcrAllowedModes',
    settableAttributes: 'OnOff, CcrMode',
  },
  {
    id: 111008,
    hiloId: 'urn:hilo:philo:6a7b8c9d0e1f:0',
    identifier: '6a7b8c9d0e1f',
    name: 'Gradateur cuisine',
    type: 'LightDimmer',
    category: 'Light',
    modelNumber: 'DM2500ZB',
    locationId: LOCATION_ID,
    provider: 9,
    supportedAttributesList: ['OnOff', 'Intensity', 'Power', 'Disconnected'],
    settableAttributesList: ['OnOff', 'Intensity'],
    Disconnected: { value: false },
  },
];

// DevicesValuesReceived (the shape python-hilo's parse_values_received reads).
export const deviceValues = [
  {
    deviceId: 111000,
    locationId: LOCATION_ID,
    timeStampUTC: '2026-01-04T18:00:00Z',
    attribute: 'CurrentTemperature',
    value: 20.46,
    valueType: 'Celsius',
  },
  {
    deviceId: 111000,
    locationId: LOCATION_ID,
    timeStampUTC: '2026-01-04T18:00:00Z',
    attribute: 'TargetTemperature',
    value: 21,
    valueType: 'Celsius',
  },
  {
    deviceId: 111000,
    locationId: LOCATION_ID,
    timeStampUTC: '2026-01-04T18:00:00Z',
    attribute: 'Power',
    value: 1500,
    valueType: 'Watt',
  },
  {
    deviceId: 111004,
    locationId: LOCATION_ID,
    timeStampUTC: '2026-01-04T18:00:00Z',
    attribute: 'OnOff',
    value: true,
    valueType: 'OnOff',
  },
  {
    deviceId: 111008,
    locationId: LOCATION_ID,
    timeStampUTC: '2026-01-04T18:00:00Z',
    attribute: 'Intensity',
    value: 0.42,
    valueType: 'Percentage',
  },
  {
    deviceId: 111004,
    locationId: LOCATION_ID,
    timeStampUTC: '2026-01-04T18:00:00Z',
    attribute: 'ZigBeeChannel',
    value: 25,
    valueType: 'Integer',
  },
];

// getLocation (the fields of python-hilo's QUERY_GET_LOCATION).
export const graphqlLocation = {
  getLocation: {
    hiloId: URN,
    lastUpdate: '2026-01-04T18:00:00Z',
    lastUpdateVersion: 3,
    devices: [
      {
        deviceType: 'Hub',
        hiloId: 'urn:hilo:philo:gateway:0',
        connectionStatus: 1,
        controllerSoftwareVersion: '9.3.0',
        lastConnectionTime: '2026-01-04T17:59:00Z',
        willBeConnectedToSmartMeter: true,
        zigBeeChannel: 25,
        zigBeePairingModeEnhanced: false,
      },
      {
        deviceType: 'Meter',
        hiloId: 'urn:hilo:philo:0x006baa0000000001-smart_meter:0',
        connectionStatus: 1,
        zigBeeChannel: 25,
        power: { value: 4.32, kind: 'KILOWATT' },
      },
      {
        deviceType: 'Tstat',
        hiloId: 'urn:hilo:philo:1a2b3c4d5e6f:0',
        connectionStatus: 'Connected',
        ambientHumidity: 38,
        gDState: 'Inactive',
        version: '1.2',
        zigbeeVersion: '3',
        ambientTemperature: { value: 20.5, kind: 'CELSIUS' },
        ambientTempSetpoint: { value: 21, kind: 'CELSIUS' },
        maxAmbientTempSetpoint: { value: 30, kind: 'CELSIUS' },
        minAmbientTempSetpoint: { value: 5, kind: 'CELSIUS' },
        heatDemand: 60,
        power: { value: 900, kind: 'WATT' },
        mode: 'Heat',
        allowedModes: ['Heat'],
      },
      {
        deviceType: 'Dimmer',
        hiloId: 'urn:hilo:philo:6a7b8c9d0e1f:0',
        connectionStatus: 'Disconnected',
        state: 'On',
        level: 75,
        power: { value: 12, kind: 'WATT' },
      },
    ],
  },
};

// onAnyDeviceUpdated (python-hilo SUBSCRIPTION_DEVICE_UPDATED).
export const graphqlUpdate = (setpoint) => ({
  onAnyDeviceUpdated: {
    deviceType: 'Tstat',
    locationHiloId: URN,
    transmissionTime: '2026-01-04T18:05:00Z',
    operationId: 'op-1',
    status: 'Success',
    device: {
      deviceType: 'Tstat',
      hiloId: 'urn:hilo:philo:1a2b3c4d5e6f:0',
      connectionStatus: 'Connected',
      ambientTemperature: { value: 20.7, kind: 'CELSIUS' },
      ambientTempSetpoint: { value: setpoint, kind: 'CELSIUS' },
      power: { value: 1.2, kind: 'KILOWATT' },
    },
  },
});

// --- challenges (python-hilo doc/Challenge(Event) JSON, 2025-26 season) ------

// EventAdded.json: challenge 354, Rate D with winter credits, evening.
export const eventAdded = {
  id: 354,
  ratePlan: 'CH',
  period: 'PM',
  phases: {
    planPublicationStartUtc: '2026-01-04T16:01:00Z',
    settingsDeadlineUTC: '2026-01-04T05:00:00Z',
    preheatStartDateUTC: '2026-01-04T19:00:00Z',
    preheatEndDateUTC: '2026-01-04T21:00:00Z',
    reductionStartDateUTC: '2026-01-04T21:00:00Z',
    reductionEndDateUTC: '2026-01-05T01:00:00Z',
    recoveryStartDateUTC: '2026-01-05T01:00:00Z',
    recoveryEndDateUTC: '2026-01-05T02:00:00Z',
  },
  progress: 'scheduled',
  isAutomated: true,
  isConfigurable: true,
  currentPhase: null,
  isPreseasonEvent: false,
};

// EventCHDetailsUpdatedValuesReceived.json (id moved to 354).
export const eventDetailsUpdated = {
  id: 354,
  isConfigurable: false,
  progress: 'inProgress',
  currentPhase: 'reduction',
  generatedTimeUTC: '2026-01-04T21:00:04.3288792Z',
};

// EventCHConsumptionUpdatedValuesReceived(en cours de défi).json (points trimmed).
export const eventConsumption = {
  currentWh: 250.0,
  baselineWh: 45058.03108215332,
  isCapped: false,
  reward: 2.26,
  energySavingsWh: 3990.079,
  isInsufficientEnergySavings: false,
  cumulativeBaselinePoints: [
    { timeUTC: '2026-01-04T21:00:00+00:00', wh: 0.0 },
    { timeUTC: '2026-01-05T01:00:00+00:00', wh: 45058.03108215332 },
  ],
  generatedTimeUTC: '2026-01-04T21:21:09.0933869Z',
  isMissingBaseline: false,
  isMissingConsumption: false,
};

// EventCHDetailsInitialValuesReceived.json: a completed challenge with its report.
export const eventDetailsCompleted = {
  report: {
    status: 'Success',
    isCredited: false,
    isFlatRate: false,
    isInsufficientReduction: false,
  },
  consumption: {
    currentWh: 9338.39990234375,
    baselineWh: 14570.39999961853,
    isCapped: false,
    reward: 2.97,
    energySavingsWh: 5232.00009727478,
    isInsufficientEnergySavings: false,
    cumulativeBaselinePoints: [
      { timeUTC: '2025-12-14T21:00:00+00:00', wh: 0.0 },
      { timeUTC: '2025-12-15T01:00:00+00:00', wh: 14570.39999961853 },
    ],
  },
  id: 348,
  progress: 'completed',
  period: 'PM',
  phases: {
    settingsDeadlineUTC: '2025-12-14T05:00:00Z',
    preheatStartDateUTC: '2025-12-14T19:00:00Z',
    preheatEndDateUTC: '2025-12-14T21:00:00Z',
    reductionStartDateUTC: '2025-12-14T21:00:00Z',
    reductionEndDateUTC: '2025-12-15T01:00:00Z',
    recoveryStartDateUTC: '2025-12-15T01:00:00Z',
    recoveryEndDateUTC: '2025-12-15T02:00:00Z',
  },
  isAutomated: true,
  isConfigurable: false,
  parameters: { mode: 'extreme', devices: [] },
  isPreSeason: false,
  kWhCost: 0.56786,
};

// EventFlexDetailsInitialValuesReceived.json: a Flex D challenge (no reward).
export const flexDetails = {
  consumption: {
    baselineWh: 8848.80006313324,
    baselineCost: 3.98,
    reductionStatus: 'pending',
    cumulativeBaselinePoints: [
      { cost: 0.0, timeUTC: '2026-01-05T11:00:00+00:00', wh: 0.0 },
      { cost: 3.98, timeUTC: '2026-01-05T15:00:00+00:00', wh: 8848.80006313324 },
    ],
  },
  id: 355,
  progress: 'scheduled',
  period: 'AM',
  phases: {
    settingsDeadlineUTC: '2026-01-05T05:00:00Z',
    preheatStartDateUTC: '2026-01-05T06:00:00Z',
    preheatEndDateUTC: '2026-01-05T11:00:00Z',
    reductionStartDateUTC: '2026-01-05T11:00:00Z',
    reductionEndDateUTC: '2026-01-05T15:00:00Z',
    recoveryStartDateUTC: '2026-01-05T15:00:00Z',
    recoveryEndDateUTC: '2026-01-05T16:00:00Z',
  },
  isAutomated: true,
  isConfigurable: true,
  parameters: { mode: 'ambitious', devices: [] },
  isPreSeason: false,
  kWhCost: 0.45088,
};

// Old JSONs/ChallengeListInitialValuesReceived.json (legacy, Python reprs as strings).
export const legacyList = [
  {
    progress: 'scheduled',
    isParticipating: 'True',
    isConfigurable: 'True',
    currentPhase: 'None',
    id: 274,
    period: 'pm',
    phases: {
      settingsDeadlineUtc: '2025-01-05T05:00:00Z',
      preheatStartDateUTC: '2025-01-05T20:00:00Z',
      preheatEndDateUTC: '2025-01-05T22:00:00Z',
      reductionStartDateUTC: '2025-01-05T22:00:00Z',
      reductionEndDateUTC: '2025-01-06T02:00:00Z',
      recoveryStartDateUTC: '2025-01-06T02:00:00Z',
      recoveryEndDateUTC: '2025-01-06T03:00:00Z',
    },
  },
];

// seasonssummary, then rates/{ratePlan}/seasons/{season}/events (Postman collection).
export const seasonsSummary = [{ season: 2025, ratePlan: 'ch', periodId: 'Q0h8dXJuOmhpbG8' }];
export const seasonEvents = {
  season: 2025,
  events: [
    {
      id: 332,
      startDateUtc: '2025-11-27T21:00:00Z',
      period: 'PM',
      reward: 10.8,
      status: 'Success',
    },
    {
      id: 348,
      startDateUtc: '2025-12-14T21:00:00Z',
      period: 'PM',
      reward: 2.97,
      status: 'Success',
    },
    {
      id: 300,
      startDateUtc: '2025-11-10T21:00:00Z',
      period: 'PM',
      reward: 1.5,
      status: 'Success',
      isPreseasonEvent: true,
    },
  ],
};

export const at = (iso) => Date.parse(iso);
