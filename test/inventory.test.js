import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deviceKey,
  normalizeDevice,
  normalizeDevices,
  readValue,
  readingsFromGraphql,
  readingsFromHub,
  readingsFromList,
  readingsFromLocation,
  readingsFromSubscription,
} from '../src/inventory.js';
import * as F from './fixtures/hilo.js';

test('the device list: kinds, attribute lists (arrays or CSV), manufacturers', () => {
  const devices = normalizeDevices(F.deviceList);
  const byName = Object.fromEntries(devices.map((d) => [d.name, d]));
  assert.equal(devices.length, F.deviceList.length);
  assert.equal(byName['Thermostat salon'].kind, 'thermostat');
  assert.ok(byName['Thermostat salon'].settable.has('TargetTemperature'));
  assert.equal(byName['SmartEnergyMeter'].kind, 'meter');
  assert.equal(byName['Extérieur'].kind, 'weather');
  assert.equal(byName['Extérieur'].manufacturer, 'Netatmo');
  assert.deepEqual(
    [...byName['Extérieur'].supported],
    ['CurrentTemperature', 'Humidity', 'BatteryPercent', 'Disconnected'],
  );
  assert.equal(byName['Chauffe-eau'].kind, 'water-heater');
  assert.ok(byName['Chauffe-eau'].settable.has('OnOff'));
  assert.ok(byName['Chauffe-eau'].supported.has('CurrentTemperature'));
  assert.equal(byName['Gradateur cuisine'].kind, 'light');
  assert.equal(byName['Gradateur cuisine'].manufacturer, 'Sinopé');
  assert.equal(byName['OneLink FirstAlert'].kind, 'smoke');
  assert.equal(byName['OneLink FirstAlert'].supported.size, 0);
});

test('Jasco outlets under the Hilo brand are outlets, whatever their type', () => {
  const device = normalizeDevice({ id: 9, type: 'LightSwitch', modelNumber: '43100', provider: 1 });
  assert.equal(device.kind, 'outlet');
  assert.equal(normalizeDevice({ id: 9, type: 'LightSwitch', provider: 1 }).kind, 'light');
});

test('keys: from the hardware identifier, id-safe; the Hilo id without one', () => {
  assert.equal(deviceKey({ identifier: 'BC:8E:B2:F2:D2:CA' }), 'bc-8e-b2-f2-d2-ca');
  assert.equal(
    deviceKey({ identifier: '0x006baa0000000001-smart_meter' }),
    '0x006baa0000000001-smart_meter',
  );
  assert.equal(deviceKey({ id: 42 }), 'id-42');
  assert.equal(normalizeDevice(null), null);
  assert.equal(normalizeDevice({ name: 'no id' }), null);
});

test('hub readings: our attributes only, values typed', () => {
  const readings = readingsFromHub(F.deviceValues);
  assert.deepEqual(
    readings.map((r) => [r.deviceId, r.attribute, r.value]),
    [
      [111000, 'CurrentTemperature', 20.46],
      [111000, 'TargetTemperature', 21],
      [111000, 'Power', 1500],
      [111004, 'OnOff', true],
      [111008, 'Intensity', 0.42],
    ],
  );
  assert.deepEqual(readingsFromHub(null), []);
  assert.equal(readValue('OnOff', 'False'), false);
  assert.equal(readValue('OnOff', { value: true }), true);
  assert.equal(readValue('Power', 'None'), undefined);
  assert.equal(readValue('Unknown', 1), undefined);
});

test('readings carried by the device list', () => {
  assert.deepEqual(readingsFromList(F.deviceList), [
    {
      deviceId: 111008,
      hiloId: 'urn:hilo:philo:6a7b8c9d0e1f:0',
      attribute: 'Disconnected',
      value: false,
    },
  ]);
});

test('GraphQL: kilowatts to watts, level / 100, connection, thermostat values', () => {
  const readings = readingsFromLocation(F.graphqlLocation);
  const of = (hiloId) =>
    Object.fromEntries(
      readings.filter((r) => r.hiloId === hiloId).map((r) => [r.attribute, r.value]),
    );
  assert.deepEqual(of('urn:hilo:philo:0x006baa0000000001-smart_meter:0'), {
    Disconnected: false,
    Power: 4320,
  });
  assert.deepEqual(of('urn:hilo:philo:1a2b3c4d5e6f:0'), {
    Disconnected: false,
    Power: 900,
    CurrentTemperature: 20.5,
    TargetTemperature: 21,
    MinTempSetpoint: 5,
    MaxTempSetpoint: 30,
    Humidity: 38,
    HeatDemand: 60,
  });
  assert.deepEqual(of('urn:hilo:philo:6a7b8c9d0e1f:0'), {
    Disconnected: true,
    Power: 12,
    OnOff: true,
    Intensity: 0.75,
  });
  // The hub is not a device of ours, but its connection reads.
  assert.deepEqual(of('urn:hilo:philo:gateway:0'), { Disconnected: false });
  assert.deepEqual(readingsFromGraphql({ hiloId: 'x' }), []);
});

test('GraphQL subscription event', () => {
  const readings = readingsFromSubscription(F.graphqlUpdate(19));
  assert.deepEqual(
    readings.map((r) => [r.attribute, r.value]),
    [
      ['Disconnected', false],
      ['Power', 1200],
      ['CurrentTemperature', 20.7],
      ['TargetTemperature', 19],
    ],
  );
  assert.deepEqual(readingsFromSubscription({}), []);
  assert.deepEqual(
    readingsFromGraphql({ deviceType: 'ChargingPoint', hiloId: 'c', status: 1 }).map(
      (r) => r.value,
    ),
    [0],
  );
  assert.deepEqual(
    readingsFromGraphql({
      deviceType: 'Cee',
      hiloId: 'w',
      state: 'Off',
      probeTemp: { value: 55.5 },
    }).map((r) => [r.attribute, r.value]),
    [
      ['CurrentTemperature', 55.5],
      ['OnOff', false],
    ],
  );
});
