import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  challengesDevice,
  commandOf,
  gladysDevice,
  parseExternalId,
  rolesOf,
  stateOf,
} from '../src/devices.js';
import { normalizeDevices } from '../src/inventory.js';
import * as F from './fixtures/hilo.js';

const devices = normalizeDevices(F.deviceList);
const named = (name) => devices.find((d) => d.name === name);

test('roles per kind, from the supported attributes', () => {
  assert.deepEqual(rolesOf(named('Thermostat salon')), [
    'temperature',
    'setpoint',
    'humidity',
    'power',
    'energy',
  ]);
  assert.deepEqual(rolesOf(named('SmartEnergyMeter')), ['power', 'energy']);
  assert.deepEqual(rolesOf(named('Prise bureau')), ['state', 'power', 'energy']);
  assert.deepEqual(rolesOf(named('Chauffe-eau')), [
    'water-heater',
    'probe-temperature',
    'power',
    'energy',
  ]);
  assert.deepEqual(rolesOf(named('Gradateur cuisine')), ['light', 'brightness', 'power', 'energy']);
  assert.deepEqual(rolesOf(named('Extérieur')), ['temperature', 'humidity', 'battery']);
  assert.deepEqual(rolesOf(named('OneLink FirstAlert')), []);
});

test('the fake Gladys accepts every device we publish', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  const list = devices
    .map((d) => gladysDevice(gladys, d, { language: 'fr' }))
    .filter(Boolean)
    .concat(challengesDevice(gladys, F.LOCATION_ID, 'fr'));
  await gladys.publishDiscoveredDevices(list);
  assert.equal(gladys.fake.discoveredDevices.length, 7);
  const thermostat = list.find((d) => d.name === 'Thermostat salon');
  assert.equal(thermostat.external_id, 'ext:test-integration:device:1a2b3c4d5e6f');
  assert.deepEqual(
    thermostat.features.map((f) => [f.external_id.split(':').at(-1), f.name, f.read_only]),
    [
      ['temperature', 'Température', true],
      ['setpoint', 'Consigne', false],
      ['humidity', 'Humidité', true],
      ['power', 'Puissance', true],
      ['energy', "Énergie (d'après la puissance)", true],
    ],
  );
  const challenges = list.at(-1);
  assert.equal(challenges.external_id, 'ext:test-integration:challenges:4051');
  assert.equal(challenges.name, 'Défis Hilo');
  assert.equal(challenges.features.length, 12);
});

test('a feature whose attribute is not settable is read-only; setpoint range', () => {
  const gladys = createFakeGladys();
  const meter = gladysDevice(gladys, named('SmartEnergyMeter'), { language: 'en' });
  assert.ok(meter.features.every((f) => f.read_only));
  const readOnlyThermostat = { ...named('Thermostat salon'), settable: new Set() };
  const built = gladysDevice(gladys, readOnlyThermostat, { setpointRange: { min: 10, max: 25 } });
  const setpoint = built.features.find((f) => f.external_id.endsWith(':setpoint'));
  assert.equal(setpoint.read_only, true);
  assert.equal(setpoint.has_feedback, false);
  assert.equal(setpoint.min, 10);
  assert.equal(setpoint.max, 25);
  assert.equal(gladysDevice(gladys, named('OneLink FirstAlert'), {}), null);
  assert.equal(built.params.find((p) => p.name === 'model').value, 'Hilo HT402');
});

test('states: binary 1/0, brightness percent, rounded temperatures, no zero humidity', () => {
  assert.deepEqual(stateOf('state', 'OnOff', true), { state: 1 });
  assert.deepEqual(stateOf('light', 'OnOff', false), { state: 0 });
  assert.deepEqual(stateOf('brightness', 'Intensity', 0.424), { state: 42 });
  assert.deepEqual(stateOf('temperature', 'CurrentTemperature', 20.46), { state: 20.5 });
  assert.deepEqual(stateOf('power', 'Power', 1499.6), { state: 1500 });
  assert.equal(stateOf('humidity', 'Humidity', 0), undefined);
  assert.equal(stateOf('setpoint', 'CurrentTemperature', 20), undefined);
});

test('commands: the Hilo attribute and value', () => {
  assert.deepEqual(commandOf('setpoint', 19.55), { attribute: 'TargetTemperature', value: 19.6 });
  assert.deepEqual(commandOf('state', 1), { attribute: 'OnOff', value: true });
  assert.deepEqual(commandOf('water-heater', 0), { attribute: 'OnOff', value: false });
  assert.deepEqual(commandOf('brightness', 42), { attribute: 'Intensity', value: 0.42 });
  assert.deepEqual(commandOf('brightness', 140), { attribute: 'Intensity', value: 1 });
  assert.equal(commandOf('power', 3), undefined);
});

test('external ids parse back', () => {
  assert.deepEqual(parseExternalId('ext:sel:device:1a2b3c4d5e6f:setpoint'), {
    kind: 'device',
    key: '1a2b3c4d5e6f',
    role: 'setpoint',
  });
  assert.deepEqual(parseExternalId('ext:sel:challenges:4051'), {
    kind: 'challenges',
    key: '4051',
    role: undefined,
  });
  assert.equal(parseExternalId('ext:sel:other:1'), undefined);
});
