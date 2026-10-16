import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hub, createHubConnection, signalrLogger } from '../src/hubs.js';
import { fakeHubFactory, manualTimers, settle, silent } from './helpers/fakeHilo.js';

function hub(factory, overrides = {}) {
  const timers = manualTimers();
  const messages = [];
  let connections = 0;
  const instance = new Hub({
    name: 'DeviceHub',
    url: 'https://api.hiloenergie.com/DeviceHub',
    headers: { 'ocp-apim-subscription-key': 'k' },
    accessTokenFactory: async () => 'token',
    targets: ['DevicesValuesReceived', 'Heartbeat'],
    onMessage: (target, args) => messages.push([target, args]),
    onConnected: async () => {
      connections += 1;
    },
    createConnection: factory.create,
    logger: silent,
    timers,
    ...overrides,
  });
  return { instance, timers, messages, connections: () => connections };
}

test('connects, relays the messages, sends, and stops', async () => {
  const factory = fakeHubFactory();
  const { instance, messages, connections } = hub(factory);
  instance.start();
  await settle();
  assert.equal(instance.connected, true);
  assert.equal(connections(), 1);
  const connection = factory.connections[0];
  assert.deepEqual(connection.headers, { 'ocp-apim-subscription-key': 'k' });
  connection.emit('DevicesValuesReceived', [{ deviceId: 1 }]);
  assert.deepEqual(messages, [['DevicesValuesReceived', [[{ deviceId: 1 }]]]]);
  assert.equal(await instance.send('SubscribeToLocation', 4051), true);
  assert.deepEqual(connection.sent, [{ method: 'SubscribeToLocation', args: [4051] }]);
  await instance.stop();
  assert.equal(await instance.send('SubscribeToLocation', 4051), false);
});

test('a failed start and a closed connection reconnect with a doubling delay', async () => {
  const factory = fakeHubFactory();
  factory.failStart = 2;
  const { instance, timers, connections } = hub(factory);
  instance.start();
  await settle();
  assert.deepEqual(timers.delays(), [5000]);
  await timers.runTimeouts();
  await settle();
  assert.deepEqual(timers.delays(), [10000]);
  await timers.runTimeouts();
  await settle();
  assert.equal(instance.connected, true);
  assert.equal(connections(), 1);
  // Reset after a success: a close waits 5 s again, then subscribes again.
  factory.connections[0].close(new Error('Server timeout elapsed'));
  assert.equal(instance.connected, false);
  assert.equal(instance.lastError, 'Server timeout elapsed');
  assert.deepEqual(timers.delays(), [5000]);
  await timers.runTimeouts();
  await settle();
  assert.equal(connections(), 2);
  await instance.stop();
});

test('a fatal error (dead session) stops the loop', async () => {
  const factory = fakeHubFactory();
  factory.startError = new Error('Failed to complete negotiation: SignInNeededError');
  let fatal = null;
  const { instance, timers } = hub(factory, {
    isFatal: () => true,
    onFatal: (err) => {
      fatal = err;
    },
  });
  instance.start();
  await settle();
  assert.match(fatal.message, /negotiation/);
  assert.equal(timers.timeouts.size, 0);
  await instance.stop();
});

test('a message handler that throws does not break the hub', async () => {
  const factory = fakeHubFactory();
  const { instance } = hub(factory, {
    onMessage: () => {
      throw new Error('boom');
    },
  });
  instance.start();
  await settle();
  factory.connections[0].emit('Heartbeat', '2026-01-04T18:00:00Z');
  assert.equal(instance.connected, true);
  await instance.stop();
});

test('the real SignalR connection is built without starting', () => {
  const connection = createHubConnection({
    url: 'https://api.hiloenergie.com/DeviceHub',
    headers: {},
    accessTokenFactory: async () => 'token',
    logger: silent,
  });
  assert.equal(typeof connection.start, 'function');
  assert.equal(typeof connection.on, 'function');
  assert.equal(connection.state, 'Disconnected');
});

test('SignalR logs: errors as warnings, the missing-handler warnings as debug', () => {
  const lines = [];
  const logger = {
    debug: (m) => lines.push(['debug', m]),
    info: (m) => lines.push(['info', m]),
    warn: (m) => lines.push(['warn', m]),
  };
  const log = signalrLogger(logger);
  log.log(4, 'Connection disconnected');
  log.log(3, "No client method with the name 'unknown' found.");
  log.log(3, 'Reconnecting');
  log.log(1, 'Starting');
  assert.deepEqual(
    lines.map(([level]) => level),
    ['warn', 'debug', 'info', 'debug'],
  );
});
