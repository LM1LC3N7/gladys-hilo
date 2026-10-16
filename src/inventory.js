// -----------------------------------------------------------------------------
// Hilo answers -> plain objects (pure functions).
//
// - The device list comes from the DeviceHub (`DeviceListInitialValuesReceived`,
//   `DeviceAdded`), as python-hilo 2026.10.1 does since the REST device list
//   was retired; the attributes lists arrive as arrays (`supportedAttributesList`)
//   or comma-separated strings (`supportedAttributes`).
// - The readings come from the DeviceHub (`DevicesValuesReceived`:
//   `{ deviceId, attribute, value, valueType, timeStampUTC }`) and from the
//   GraphQL digital twin (`getLocation`, `onAnyDeviceUpdated`), mapped to the
//   same attribute names as pyhilo/device/graphql_value_mapper.py (MIT License,
//   Copyright (c) 2020-2024 David Vallee Delisle) does.
// -----------------------------------------------------------------------------

import { DEVICE_KINDS, JASCO_OUTLETS } from './constants.js';

// python-hilo HILO_PROVIDERS.
const PROVIDERS = {
  0: 'Hilo',
  1: 'Hilo',
  2: 'Netatmo',
  3: 'OneLink',
  5: 'Elmec',
  6: 'Resideo',
  7: 'Resideo TCC',
  8: 'Mysa',
  9: 'Sinopé',
};

const list = (array, csv) => {
  const items = Array.isArray(array) ? array : String(csv ?? '').split(',');
  return new Set(
    items.map((item) => String(item).trim()).filter((item) => item !== '' && item !== 'None'),
  );
};

/** A stable, id-safe key from the hardware identifier (MAC, Zigbee EUI). */
export const deviceKey = (raw) => {
  const source = String(raw?.identifier ?? '').trim() || `id-${raw?.id}`;
  return source
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
};

/** One device of the DeviceHub list, or null when it cannot be used. */
export function normalizeDevice(raw) {
  if (!raw || typeof raw !== 'object' || raw.id === undefined || raw.id === null) {
    return null;
  }
  const type = String(raw.type ?? 'Unknown');
  const model = String(raw.modelNumber ?? raw.model_number ?? '').replace(/^Model_/, '') || null;
  const provider = Number(raw.provider);
  let kind = DEVICE_KINDS[type] ?? 'unknown';
  if ((provider === 1 || provider === 0) && model && JASCO_OUTLETS.includes(model)) {
    kind = 'outlet';
  }
  return {
    id: Number(raw.id),
    hiloId: typeof raw.hiloId === 'string' ? raw.hiloId : null,
    key: deviceKey(raw),
    identifier: raw.identifier ?? null,
    type,
    kind,
    name: String(raw.name ?? type).trim() || type,
    model,
    manufacturer: PROVIDERS[provider] ?? 'Hilo',
    supported: list(raw.supportedAttributesList, raw.supportedAttributes),
    settable: list(raw.settableAttributesList, raw.settableAttributes),
    locationId: raw.locationId ?? null,
  };
}

/** The devices of a DeviceHub list message, without duplicates. */
export function normalizeDevices(rawList) {
  const byId = new Map();
  for (const raw of Array.isArray(rawList) ? rawList : []) {
    const device = normalizeDevice(raw);
    if (device) {
      byId.set(device.id, device);
    }
  }
  return [...byId.values()];
}

const booleanOf = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  if (['true', 'on', '1'].includes(text)) {
    return true;
  }
  if (['false', 'off', '0', 'none', 'null', ''].includes(text)) {
    return false;
  }
  return null;
};

const numberOf = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// The attributes we use, and how their value reads.
const ATTRIBUTE_TYPES = {
  CurrentTemperature: numberOf,
  TargetTemperature: numberOf,
  MinTempSetpoint: numberOf,
  MaxTempSetpoint: numberOf,
  Humidity: numberOf,
  Power: numberOf,
  Intensity: numberOf,
  Heating: numberOf,
  HeatDemand: numberOf,
  ColorTemperature: numberOf,
  Hue: numberOf,
  Saturation: numberOf,
  Co2: numberOf,
  Noise: numberOf,
  Pressure: numberOf,
  BatteryPercent: numberOf,
  OnOff: booleanOf,
  Status: booleanOf,
  Disconnected: booleanOf,
  GdState: booleanOf,
  DrmsState: booleanOf,
};

/** Reads a value the way its attribute needs; undefined when the attribute is not ours. */
export function readValue(attribute, value) {
  const read = ATTRIBUTE_TYPES[attribute];
  if (!read) {
    return undefined;
  }
  // Values arrive bare or wrapped (`{ value }` in the device list).
  const bare = value && typeof value === 'object' && 'value' in value ? value.value : value;
  const result = read(bare);
  return result === null ? undefined : result;
}

/**
 * Readings of a `DevicesValuesReceived` / `GatewayValuesReceived` message:
 * [{ deviceId, attribute, value }], unknown attributes and values dropped.
 */
export function readingsFromHub(items) {
  const readings = [];
  for (const item of Array.isArray(items) ? items : []) {
    const attribute = item?.attribute;
    const value = readValue(attribute, item?.value);
    if (value === undefined || item.deviceId === undefined) {
      continue;
    }
    readings.push({
      deviceId: Number(item.deviceId),
      hiloId: item.hiloId ?? null,
      attribute,
      value,
    });
  }
  return readings;
}

/** The readings carried by the device list itself (`"Disconnected": { "value": false }`…). */
export function readingsFromList(rawList) {
  const readings = [];
  for (const raw of Array.isArray(rawList) ? rawList : []) {
    if (raw?.id === undefined) {
      continue;
    }
    for (const attribute of Object.keys(ATTRIBUTE_TYPES)) {
      if (raw[attribute] === undefined) {
        continue;
      }
      const value = readValue(attribute, raw[attribute]);
      if (value !== undefined) {
        readings.push({ deviceId: Number(raw.id), hiloId: raw.hiloId ?? null, attribute, value });
      }
    }
  }
  return readings;
}

const kilowatts = (power) => {
  if (!power || typeof power !== 'object') {
    return undefined;
  }
  const value = numberOf(power.value) ?? 0;
  return String(power.kind ?? '').toLowerCase() === 'kilowatt' ? value * 1000 : value;
};

const valueOf = (field) => (field && typeof field === 'object' ? field.value : field);

/**
 * Readings of one GraphQL device (getLocation or onAnyDeviceUpdated), keyed
 * by its hiloId: [{ hiloId, attribute, value }].
 */
export function readingsFromGraphql(device) {
  const hiloId = device?.hiloId;
  if (typeof hiloId !== 'string' || typeof device.deviceType !== 'string') {
    return [];
  }
  const out = [];
  const add = (attribute, raw) => {
    const value = readValue(attribute, raw);
    if (value !== undefined) {
      out.push({ deviceId: null, hiloId, attribute, value });
    }
  };
  const type = device.deviceType.toLowerCase();
  // Meters and the hub report the connection as a number (2 = offline), the others as text.
  if (type === 'meter' || type === 'hub') {
    add('Disconnected', device.connectionStatus === 2);
  } else if (device.connectionStatus !== undefined) {
    add('Disconnected', device.connectionStatus === 'Disconnected');
  }
  if (device.power !== undefined && device.power !== null) {
    add('Power', kilowatts(device.power));
  }
  const on = typeof device.state === 'string' ? device.state.toLowerCase() === 'on' : undefined;
  switch (type) {
    case 'tstat':
    case 'heatingfloor':
    case 'lowvoltagetstat':
      add('CurrentTemperature', valueOf(device.ambientTemperature));
      add('TargetTemperature', valueOf(device.ambientTempSetpoint));
      add('MinTempSetpoint', valueOf(device.minAmbientTempSetpoint));
      add('MaxTempSetpoint', valueOf(device.maxAmbientTempSetpoint));
      add('Humidity', device.ambientHumidity);
      add('HeatDemand', device.heatDemand);
      break;
    case 'cee':
      add('CurrentTemperature', valueOf(device.probeTemp));
      add('OnOff', on);
      break;
    case 'ccr':
    case 'switch':
      add('OnOff', on);
      break;
    case 'dimmer':
    case 'colorbulb':
    case 'whitebulb':
      add('OnOff', on);
      if (numberOf(device.level) !== null) {
        add('Intensity', device.level / 100);
      }
      add('ColorTemperature', device.colorTemperature);
      break;
    case 'chargingpoint':
      // Available (1) or out of service (0): no power drawn.
      if (device.status === 0 || device.status === 1) {
        add('Power', 0);
      }
      break;
    default:
      break;
  }
  return out;
}

/** Every GraphQL device reading of a getLocation answer. */
export function readingsFromLocation(data) {
  const devices = data?.getLocation?.devices;
  return (Array.isArray(devices) ? devices : []).flatMap(readingsFromGraphql);
}

/** The device of an onAnyDeviceUpdated event. */
export function readingsFromSubscription(data) {
  const device = data?.onAnyDeviceUpdated?.device;
  return device ? readingsFromGraphql(device) : [];
}
