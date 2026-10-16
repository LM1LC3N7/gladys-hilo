import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persistedQueryHash } from '../src/client.js';
import { QUERY_GET_LOCATION, SUBSCRIPTION_DEVICE_UPDATED } from '../src/graphqlQueries.js';

// The SHA-256 of python-hilo 2026.10.1's documents, byte for byte: the server
// knows its persisted queries by these keys.
test('the GraphQL documents are python-hilo 2026.10.1 byte for byte', () => {
  assert.equal(
    persistedQueryHash(QUERY_GET_LOCATION),
    '3c1266b6e00e318e0fea20b830daa6f4b12f637b2008f0662a284c6d1c66e701',
  );
  assert.equal(
    persistedQueryHash(SUBSCRIPTION_DEVICE_UPDATED),
    'f6d68c2ba7ab825a520a77d1ad29d66b393f6335136523c02f958c16db587b88',
  );
  assert.match(QUERY_GET_LOCATION, /^query getLocation\(\$locationHiloId: String!\)/);
  assert.match(SUBSCRIPTION_DEVICE_UPDATED, /^subscription onAnyDeviceUpdated/);
});
