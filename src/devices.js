// -----------------------------------------------------------------------------
// Hilo devices -> Gladys devices, and Hilo readings -> Gladys states (pure).
//
// One Gladys device per Hilo device, `ext:<selector>:device:<identifier>` (the
// hardware identifier of the device: MAC, Zigbee EUI; its Hilo id when it has
// none), and one for the challenges of the location,
// `ext:<selector>:challenges:<location id>`. Features are built from the
// attributes the device supports; a feature is writable when Hilo lists its
// attribute as settable.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { GLADYS } from './constants.js';
import { DEVICE_NAMES, FEATURE_NAMES, word } from './i18n.js';

const sensor = { read_only: true, has_feedback: false, keep_history: true };
const writable = { read_only: false, has_feedback: true, keep_history: true };
const text = {
  category: C.TEXT,
  type: T.TEXT.TEXT,
  min: 0,
  max: 0,
  ...sensor,
  keep_history: false,
};
const binary = { min: 0, max: 1 };

const FEATURES = {
  temperature: {
    category: C.TEMPERATURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.CELSIUS,
    min: -50,
    max: 60,
    ...sensor,
  },
  'probe-temperature': {
    category: C.TEMPERATURE_SENSOR,
    type: T.TEMPERATURE_SENSOR.PROBE,
    unit: U.CELSIUS,
    min: 0,
    max: 100,
    ...sensor,
  },
  setpoint: {
    category: C.THERMOSTAT,
    type: T.THERMOSTAT.TARGET_TEMPERATURE,
    unit: U.CELSIUS,
    min: 5,
    max: 36,
    ...writable,
  },
  humidity: {
    category: C.HUMIDITY_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.PERCENT,
    min: 0,
    max: 100,
    ...sensor,
  },
  power: {
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.POWER,
    unit: U.WATT,
    min: 0,
    max: 100000,
    ...sensor,
  },
  energy: {
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.INDEX,
    unit: U.KILOWATT_HOUR,
    min: 0,
    max: 1000000000,
    ...sensor,
  },
  state: { category: C.SWITCH, type: T.SWITCH.BINARY, ...binary, ...writable },
  light: { category: C.LIGHT, type: T.LIGHT.BINARY, ...binary, ...writable },
  brightness: {
    category: C.LIGHT,
    type: T.LIGHT.BRIGHTNESS,
    unit: U.PERCENT,
    min: 0,
    max: 100,
    ...writable,
  },
  'water-heater': { category: C.WATER_HEATER, type: T.WATER_HEATER.BINARY, ...binary, ...writable },
  co2: {
    category: C.CO2_SENSOR,
    type: T.SENSOR.INTEGER,
    unit: U.PPM,
    min: 0,
    max: 10000,
    ...sensor,
  },
  noise: {
    category: C.NOISE_SENSOR,
    type: T.SENSOR.INTEGER,
    unit: U.DECIBEL,
    min: 0,
    max: 150,
    ...sensor,
  },
  pressure: {
    category: C.PRESSURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.MILLIBAR,
    min: 800,
    max: 1200,
    ...sensor,
  },
  battery: {
    category: C.BATTERY,
    type: T.BATTERY.INTEGER,
    unit: U.PERCENT,
    min: 0,
    max: 100,
    ...sensor,
  },
};

// The features of the challenges device.
const CHALLENGE_FEATURES = {
  status: text,
  scheduled: { category: C.ENERGY_SENSOR, type: T.ENERGY_SENSOR.BINARY, ...binary, ...sensor },
  preheat: { category: C.ENERGY_SENSOR, type: T.ENERGY_SENSOR.BINARY, ...binary, ...sensor },
  reduction: { category: C.ENERGY_SENSOR, type: T.ENERGY_SENSOR.BINARY, ...binary, ...sensor },
  recovery: { category: C.ENERGY_SENSOR, type: T.ENERGY_SENSOR.BINARY, ...binary, ...sensor },
  'reduction-start': text,
  'reduction-end': text,
  'expected-reward': {
    category: C.CURRENCY,
    type: T.CURRENCY.DECIMAL,
    unit: U.DOLLAR,
    min: 0,
    max: 10000,
    ...sensor,
  },
  'last-reward': {
    category: C.CURRENCY,
    type: T.CURRENCY.DECIMAL,
    unit: U.DOLLAR,
    min: 0,
    max: 10000,
    ...sensor,
  },
  'season-reward': {
    category: C.CURRENCY,
    type: T.CURRENCY.DECIMAL,
    unit: U.DOLLAR,
    min: 0,
    max: 100000,
    ...sensor,
  },
  baseline: {
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.ENERGY,
    unit: U.KILOWATT_HOUR,
    min: 0,
    max: 10000,
    ...sensor,
  },
  consumption: {
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.ENERGY,
    unit: U.KILOWATT_HOUR,
    min: 0,
    max: 10000,
    ...sensor,
  },
};

/** Which Hilo attribute a feature reads (and writes), per role. */
export const ATTRIBUTES = {
  temperature: 'CurrentTemperature',
  'probe-temperature': 'CurrentTemperature',
  setpoint: 'TargetTemperature',
  humidity: 'Humidity',
  power: 'Power',
  state: 'OnOff',
  light: 'OnOff',
  'water-heater': 'OnOff',
  brightness: 'Intensity',
  co2: 'Co2',
  noise: 'Noise',
  pressure: 'Pressure',
  battery: 'BatteryPercent',
};

/** The roles of the features of a Hilo device, from its kind and attributes. */
export function rolesOf(device) {
  const has = (attribute) => device.supported.has(attribute);
  const roles = [];
  switch (device.kind) {
    case 'thermostat':
      roles.push('temperature', 'setpoint');
      if (has('Humidity')) {
        roles.push('humidity');
      }
      break;
    case 'outlet':
    case 'switch':
      roles.push('state');
      break;
    case 'water-heater':
      roles.push('water-heater');
      if (has('CurrentTemperature')) {
        roles.push('probe-temperature');
      }
      break;
    case 'light':
      roles.push('light');
      if (has('Intensity')) {
        roles.push('brightness');
      }
      break;
    case 'meter':
    case 'charger':
      roles.push('power');
      break;
    case 'weather':
      for (const [attribute, role] of [
        ['CurrentTemperature', 'temperature'],
        ['Humidity', 'humidity'],
        ['Co2', 'co2'],
        ['Noise', 'noise'],
        ['Pressure', 'pressure'],
        ['BatteryPercent', 'battery'],
      ]) {
        if (has(attribute)) {
          roles.push(role);
        }
      }
      break;
    default:
      return [];
  }
  if (has('Power') && !roles.includes('power')) {
    roles.push('power');
  }
  if (roles.includes('power') || device.kind === 'meter') {
    roles.push('energy');
  }
  return [...new Set(roles)];
}

export const deviceIds = (gladys, device) => gladys.externalIds('device', device.key);
export const challengeIds = (gladys, locationId) =>
  gladys.externalIds('challenges', String(locationId));

/** The kind, the key and the role of an external id of ours. */
export function parseExternalId(externalId) {
  const match = /:(device|challenges):([^:]+)(?::([^:]+))?$/.exec(String(externalId ?? ''));
  return match ? { kind: match[1], key: match[2], role: match[3] } : undefined;
}

const named = (role, language) => word(FEATURE_NAMES[role], language);

/** The Gladys device of one Hilo device, or null when it has nothing to show. */
export function gladysDevice(gladys, device, { language, setpointRange } = {}) {
  const roles = rolesOf(device);
  if (roles.length === 0) {
    return null;
  }
  const ids = deviceIds(gladys, device);
  const features = roles.map((role) => {
    const feature = {
      ...FEATURES[role],
      name: named(role, language),
      external_id: ids.feature(role),
    };
    const attribute = ATTRIBUTES[role];
    if (!feature.read_only && attribute && !device.settable.has(attribute)) {
      feature.read_only = true;
      feature.has_feedback = false;
    }
    if (role === 'setpoint' && setpointRange) {
      feature.min = setpointRange.min;
      feature.max = setpointRange.max;
    }
    return feature;
  });
  return {
    name: device.name,
    external_id: ids.device,
    should_poll: false,
    params: [
      { name: 'hilo_id', value: String(device.id) },
      { name: 'hilo_type', value: device.type },
      {
        name: 'model',
        value: [device.manufacturer, device.model ?? device.type].filter(Boolean).join(' '),
      },
    ],
    features,
  };
}

/** The Gladys device of the challenges of the location. */
export function challengesDevice(gladys, locationId, language) {
  const ids = challengeIds(gladys, locationId);
  return {
    name: word(DEVICE_NAMES.challenges, language),
    external_id: ids.device,
    should_poll: false,
    params: [{ name: 'hilo_location', value: String(locationId) }],
    features: Object.entries(CHALLENGE_FEATURES).map(([role, feature]) => ({
      ...feature,
      name: named(role, language),
      external_id: ids.feature(role),
    })),
  };
}

/**
 * The Gladys state of one reading, or undefined when the attribute feeds no
 * feature of this role: `{ state }` (numbers).
 */
export function stateOf(role, attribute, value) {
  if (ATTRIBUTES[role] !== attribute) {
    return undefined;
  }
  switch (role) {
    case 'state':
    case 'light':
    case 'water-heater':
      return { state: value ? GLADYS.on : GLADYS.off };
    case 'brightness':
      // Hilo: 0..1.
      return { state: Math.round(Math.max(0, Math.min(1, value)) * 100) };
    case 'power':
      return { state: Math.round(Math.max(0, value)) };
    case 'temperature':
    case 'probe-temperature':
    case 'setpoint':
      return { state: Math.round(value * 10) / 10 };
    case 'humidity':
      return value > 0 ? { state: Math.round(value * 10) / 10 } : undefined;
    default:
      return { state: value };
  }
}

/** The Hilo attribute and value a Gladys command sets, or undefined (not writable). */
export function commandOf(role, value) {
  switch (role) {
    case 'setpoint':
      return { attribute: 'TargetTemperature', value: Math.round(Number(value) * 10) / 10 };
    case 'state':
    case 'light':
    case 'water-heater':
      return { attribute: 'OnOff', value: Number(value) === GLADYS.on };
    case 'brightness': {
      const percent = Math.max(0, Math.min(100, Number(value)));
      return { attribute: 'Intensity', value: Math.round(percent) / 100 };
    }
    default:
      return undefined;
  }
}
