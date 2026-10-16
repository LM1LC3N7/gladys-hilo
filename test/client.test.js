import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HiloClient, HiloError, SignInNeededError, persistedQueryHash } from '../src/client.js';
import { QUERY_GET_LOCATION } from '../src/graphqlQueries.js';
import { fakeHiloServer } from './helpers/fakeHilo.js';
import * as F from './fixtures/hilo.js';

const NOW = 1_800_000_000_000;

function client({ session, server = fakeHiloServer(), now = NOW } = {}) {
  const saved = [];
  const c = new HiloClient({
    transport: server.transport,
    now: () => now,
    onSession: async (s) => saved.push(s),
  });
  c.setSession(
    session === undefined
      ? {
          accessToken: 'valid',
          expiresAt: now + 3_600_000,
          refreshToken: 'refresh-0',
          email: F.EMAIL,
          urn: F.URN,
        }
      : session,
  );
  return { c, server, saved };
}

test('REST: bearer and API Management key, the locations', async () => {
  const { c, server } = client();
  assert.deepEqual(await c.locations(), F.locations);
  const [request] = server.requests;
  assert.equal(request.url, 'https://api.hiloenergie.com/Automation/v1/api/Locations');
  assert.equal(request.headers.authorization, 'Bearer valid');
  assert.equal(request.headers['ocp-apim-subscription-key'], '20eeaedcb86945afa3fe792cea89b8bf');
});

test('the access token is renewed 5 minutes before its end, the new refresh token kept', async () => {
  const { c, server, saved } = client({
    session: { accessToken: 'old', expiresAt: NOW + 60_000, refreshToken: 'refresh-0' },
  });
  await c.locations();
  const [token, call] = server.requests;
  assert.equal(token.host, 'connexion.hiloenergie.com');
  assert.deepEqual(token.form, {
    grant_type: 'refresh_token',
    client_id: '1ca9f585-4a55-4085-8e30-9746a65fa561',
    refresh_token: 'refresh-0',
  });
  assert.equal(call.headers.authorization, `Bearer ${F.tokens(1).access_token}`);
  assert.equal(saved.at(-1).refreshToken, 'refresh-1');
  assert.equal(saved.at(-1).urn, F.URN);
});

test('a 401 gets one new token and one retry', async () => {
  const server = fakeHiloServer();
  const original = server.transport.request;
  let first = true;
  server.transport.request = async (options) => {
    if (first && options.url.includes('/Locations')) {
      first = false;
      return { status: 401, headers: new Map(), text: '', json: undefined };
    }
    return original(options);
  };
  const { c } = client({ server });
  assert.deepEqual(await c.locations(), F.locations);
  assert.equal(server.tokenCount, 1);
});

test('a refused refresh token: SignInNeededError and a dead session', async () => {
  const server = fakeHiloServer();
  server.refuseRefresh = true;
  const { c } = client({ server, session: { accessToken: null, refreshToken: 'gone' } });
  await assert.rejects(c.locations(), (err) => {
    assert.ok(err instanceof SignInNeededError);
    assert.match(err.message, /AADB2C90080/);
    return true;
  });
  assert.equal(c.sessionDead, true);
  c.setSession(null);
  assert.equal(c.sessionDead, false);
  await assert.rejects(c.accessToken(), SignInNeededError);
});

test('exchangeCode: the code and verifier, the first session', async () => {
  const { c, server, saved } = client({ session: null });
  const session = await c.exchangeCode('the-code', 'the-verifier');
  assert.deepEqual(server.requests[0].form, {
    grant_type: 'authorization_code',
    code: 'the-code',
    redirect_uri: 'https://my.home-assistant.io/redirect/oauth',
    code_verifier: 'the-verifier',
    client_id: '1ca9f585-4a55-4085-8e30-9746a65fa561',
  });
  assert.equal(session.refreshToken, 'refresh-1');
  assert.equal(session.email, F.EMAIL);
  assert.equal(saved.length, 1);
  server.refuseCode = true;
  await assert.rejects(c.exchangeCode('again', 'v'), SignInNeededError);
});

test('setAttribute: PUT …/Locations/{id}/Devices/{id}/Attributes', async () => {
  const { c, server } = client();
  await c.setAttribute(4051, 111000, 'TargetTemperature', 19.5);
  assert.deepEqual(server.attributes, [
    {
      path: '/Automation/v1/api/Locations/4051/Devices/111000/Attributes',
      json: { TargetTemperature: 19.5 },
    },
  ]);
});

test('an HTTP error becomes a HiloError with its status', async () => {
  const server = fakeHiloServer();
  server.failLocations = 1;
  const { c } = client({ server });
  await assert.rejects(c.locations(), (err) => {
    assert.ok(err instanceof HiloError);
    assert.equal(err.status, 503);
    assert.equal(err.message, 'Service Unavailable');
    return true;
  });
});

test('seasons: the summary then the events of each season', async () => {
  const { c, server } = client();
  const seasons = await c.seasons(F.URN);
  assert.equal(seasons.length, 1);
  assert.equal(seasons[0].events.length, 3);
  assert.equal(server.requests[0].path, `/challenge/v1/api/Locations/${F.URN}/seasonssummary`);
  assert.equal(
    server.requests[1].url,
    `https://api.hiloenergie.com/challenge/v1/api/Locations/${F.URN}/rates/ch/seasons/2025/events?periodId=Q0h8dXJuOmhpbG8`,
  );
});

test('hubs: the subscription key on the DeviceHub only (python-hilo drops it on the ChallengeHub)', () => {
  const { c } = client();
  assert.equal(c.hubUrl('/DeviceHub'), 'https://api.hiloenergie.com/DeviceHub');
  assert.deepEqual(c.hubHeaders('/DeviceHub'), {
    'ocp-apim-subscription-key': '20eeaedcb86945afa3fe792cea89b8bf',
  });
  assert.deepEqual(c.hubHeaders('/ChallengeHub'), {});
});

test('GraphQL: persisted query first, its text after PersistedQueryNotFound', async () => {
  const { c, server } = client();
  const data = await c.graphql(QUERY_GET_LOCATION, { locationHiloId: F.URN });
  assert.equal(data.getLocation.devices.length, 4);
  const [first, second] = server.requests;
  assert.equal(first.url, 'https://platform.hiloenergie.com/api/digital-twin/v3/graphql');
  assert.deepEqual(first.json, {
    extensions: {
      persistedQuery: { version: 1, sha256Hash: persistedQueryHash(QUERY_GET_LOCATION) },
    },
    variables: { locationHiloId: F.URN },
  });
  assert.equal(second.json.query, QUERY_GET_LOCATION);
  assert.equal(first.headers['ocp-apim-subscription-key'], undefined);
  // Known now: one request.
  await c.graphql(QUERY_GET_LOCATION, { locationHiloId: F.URN });
  assert.equal(server.requests.length, 3);
});

test('GraphQL errors other than PersistedQueryNotFound are thrown', async () => {
  const server = fakeHiloServer();
  server.transport.request = async () => ({
    status: 200,
    headers: new Map(),
    text: '',
    json: { errors: [{ message: 'Unauthorized location' }] },
  });
  const { c } = client({ server });
  await assert.rejects(c.graphql(QUERY_GET_LOCATION, {}), /Unauthorized location/);
});
