import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphqlSubscription, parseSse } from '../src/subscription.js';
import { HiloClient } from '../src/client.js';
import { SUBSCRIPTION_DEVICE_UPDATED } from '../src/graphqlQueries.js';
import { fakeHiloServer, manualTimers, settle, silent } from './helpers/fakeHilo.js';
import * as F from './fixtures/hilo.js';

test('parseSse: events, multi-line data, comments, the unfinished rest', () => {
  const { events, rest } = parseSse(
    ': keepalive\n\nevent: next\ndata: {"a":1}\n\ndata: line1\r\ndata: line2\r\n\r\nevent: complete\n\nevent: next\ndata: {"b"',
  );
  assert.deepEqual(events, [
    { event: 'next', data: '{"a":1}' },
    { event: 'message', data: 'line1\nline2' },
    { event: 'complete', data: '' },
  ]);
  assert.equal(rest, 'event: next\ndata: {"b"');
});

function subscription(server, onData, onReconnected = async () => {}) {
  const client = new HiloClient({ transport: server.transport, now: () => 0 });
  client.setSession({ accessToken: 'valid', expiresAt: 3_600_000, refreshToken: 'r' });
  const timers = manualTimers();
  const sub = new GraphqlSubscription({
    client,
    query: SUBSCRIPTION_DEVICE_UPDATED,
    variables: { locationHiloId: F.URN },
    onData,
    onReconnected,
    logger: silent,
    timers,
  });
  return { sub, timers };
}

test('the stream delivers data; PersistedQueryNotFound reopens it with the query', async () => {
  const server = fakeHiloServer();
  const received = [];
  const { sub } = subscription(server, async (data) => received.push(data));
  sub.start();
  await settle();
  assert.equal(server.streams.length, 1);
  assert.equal(server.streams[0].json.query, undefined);
  assert.equal(server.streams[0].headers.authorization, 'Bearer valid');
  server.streams[0].chunks.push(
    'event: next\ndata: {"errors":[{"message":"PersistedQueryNotFound"}]}\n\n',
  );
  await settle();
  assert.equal(server.streams.length, 2);
  assert.equal(server.streams[1].json.query, SUBSCRIPTION_DEVICE_UPDATED);
  assert.equal(sub.open, true);
  const update = JSON.stringify({ data: F.graphqlUpdate(19) });
  server.streams[1].chunks.push(`event: next\ndata: ${update.slice(0, 40)}`);
  server.streams[1].chunks.push(`${update.slice(40)}\n\n`);
  await settle();
  assert.deepEqual(received, [F.graphqlUpdate(19)]);
  await sub.stop();
  assert.equal(sub.open, false);
});

test('a closed stream reconnects after the backoff and reads the location again', async () => {
  const server = fakeHiloServer();
  let reads = 0;
  const { sub, timers } = subscription(
    server,
    async () => {},
    async () => {
      reads += 1;
    },
  );
  sub.start();
  await settle();
  server.streams[0].chunks.end();
  await settle();
  assert.deepEqual(timers.delays(), [5000]);
  await timers.runTimeouts();
  await settle();
  assert.equal(reads, 1);
  assert.equal(server.streams.length, 2);
  await sub.stop();
});

test('a refused stream (HTTP 500) backs off 5 s, 10 s…', async () => {
  const server = fakeHiloServer();
  server.streamStatus = 500;
  const { sub, timers } = subscription(server, async () => {});
  sub.start();
  await settle();
  assert.deepEqual(timers.delays(), [5000]);
  await timers.runTimeouts();
  await settle();
  assert.deepEqual(timers.delays(), [10000]);
  await sub.stop();
  assert.equal(timers.timeouts.size, 0);
});

test('a silent stream is aborted by the watchdog', async () => {
  const server = fakeHiloServer();
  const { sub, timers } = subscription(server, async () => {});
  sub.start();
  await settle();
  // The watchdog (180 s) is the only timer while the stream is open.
  assert.deepEqual(timers.delays(), [180000]);
  await timers.runTimeouts();
  await settle();
  assert.equal(sub.open, false);
  assert.deepEqual(timers.delays(), [5000]);
  await sub.stop();
});
