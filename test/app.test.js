import { test } from 'node:test';
import assert from 'node:assert/strict';
import { F, flush, settle, startApp, storedSession } from './helpers/fakeHilo.js';

const START = F.at('2026-01-04T18:00:00Z');
const HOUR = 3_600_000;

const id = (suffix) => `ext:test-integration:${suffix}`;
const thermostat = (role) => id(`device:1a2b3c4d5e6f${role ? `:${role}` : ''}`);
const challenge = (role) => id(`challenges:${F.LOCATION_ID}${role ? `:${role}` : ''}`);

/** Signed in, the device list received, the challenge hub connected. */
async function online(options = {}) {
  const env = await startApp({ memory: storedSession(START), ...options });
  const device = env.hubs.hub('/DeviceHub');
  device.emit('DeviceListInitialValuesReceived', F.deviceList);
  await settle();
  await flush(env.app);
  return { ...env, device, challengeHub: env.hubs.hub('/ChallengeHub') };
}

test('not signed in: the status says how; "Connect" returns the Hilo page and keeps the PKCE', async () => {
  const { gladys, store, hubs } = await startApp();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /Connecter/);
  assert.equal(hubs.connections.length, 0);
  const ack = await gladys.fake.oauthAuthorizeUrl('hilo_account');
  assert.equal(ack.success, true);
  const url = new URL(ack.data.authorize_url);
  assert.equal(url.host, 'connexion.hiloenergie.com');
  assert.equal(url.searchParams.get('state'), store.data.pending.state);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(store.data.pending.verifier.length >= 43);
  assert.match(gladys.fake.connectionStatus.message.en, /Finish the sign-in/);
});

test('"Finish the sign-in": the pasted address -> tokens in /data -> online', async () => {
  const { gladys, store, server, hubs, clock } = await startApp({ config: { language: 'en' } });
  const { data } = await gladys.fake.oauthAuthorizeUrl('hilo_account');
  const state = new URL(data.authorize_url).searchParams.get('state');

  const bad = await gladys.fake.action('finish_sign_in', { redirect_url: 'nothing useful' });
  assert.equal(bad.success, false);
  assert.match(bad.error, /no sign-in code/);
  const other = await gladys.fake.action('finish_sign_in', {
    redirect_url: 'https://my.home-assistant.io/redirect/oauth?state=other&code=c',
  });
  assert.match(other.error, /another sign-in/);

  const ack = await gladys.fake.action('finish_sign_in', {
    redirect_url: `https://my.home-assistant.io/redirect/oauth?state=${state}&code=the-code`,
  });
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /Connected to Hilo as client@example\.com/);
  const exchange = server.requests.find((r) => r.form?.grant_type === 'authorization_code');
  assert.equal(exchange.form.code, 'the-code');
  assert.equal(
    exchange.form.code_verifier,
    store.data.pending?.verifier ?? exchange.form.code_verifier,
  );
  assert.equal(store.data.pending, null);
  assert.equal(store.data.session.refreshToken, 'refresh-1');
  await settle();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.fr, /client@example\.com/);
  assert.deepEqual(
    hubs.connections.map((c) => c.url),
    ['https://api.hiloenergie.com/DeviceHub', 'https://api.hiloenergie.com/ChallengeHub'],
  );
  // A code pasted after 30 minutes: start again.
  await gladys.fake.oauthAuthorizeUrl('hilo_account');
  clock.now += 31 * 60_000;
  const late = await gladys.fake.action('finish_sign_in', { redirect_url: 'code=abc' });
  assert.match(late.error, /No sign-in in progress/);
});

test('a code Hilo refuses tells the user to start again', async () => {
  const { gladys, server } = await startApp({ config: { language: 'en' } });
  const { data } = await gladys.fake.oauthAuthorizeUrl('hilo_account');
  const state = new URL(data.authorize_url).searchParams.get('state');
  server.refuseCode = true;
  const ack = await gladys.fake.action('finish_sign_in', {
    redirect_url: `https://my.home-assistant.io/redirect/oauth?state=${state}&code=used`,
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /refused the code.*AADB2C90088/);
});

test('online: subscriptions, devices to Discovery, values from the hub and the digital twin', async () => {
  const { gladys, device, challengeHub, server, app } = await online();
  assert.deepEqual(device.sent, [{ method: 'SubscribeToLocation', args: [F.LOCATION_ID] }]);
  assert.deepEqual(device.headers, {
    'ocp-apim-subscription-key': '20eeaedcb86945afa3fe792cea89b8bf',
  });
  assert.deepEqual(challengeHub.headers, {});
  assert.deepEqual(challengeHub.sent, [
    { method: 'SubscribeToChallengeList', args: [{ locationId: F.LOCATION_ID }] },
    { method: 'SubscribeToEventList', args: [{ locationHiloId: F.URN }] },
  ]);
  assert.equal(await device.accessTokenFactory(), F.jwt());

  const discovered = gladys.fake.discoveredDevices;
  assert.deepEqual(
    discovered.map((d) => d.name),
    [
      'SmartEnergyMeter',
      'Thermostat salon',
      'Extérieur',
      'Prise bureau',
      'Chauffe-eau',
      'Gradateur cuisine',
      'Défis Hilo',
    ],
  );
  // The digital twin: persisted query, then its text, then the stream.
  const graphql = server.requests.filter((r) => r.url?.includes('platform.hiloenergie.com'));
  assert.equal(graphql.length, 3);
  assert.equal(graphql.filter((r) => r.stream).length, 1);
  assert.equal(graphql.filter((r) => r.json.query).length, 1);
  assert.equal(gladys.fake.lastState(id('device:0x006baa0000000001-smart_meter:power')), 4320);
  assert.equal(gladys.fake.lastState(thermostat('temperature')), 20.5);
  assert.equal(gladys.fake.lastState(thermostat('humidity')), 38);
  assert.equal(gladys.fake.lastState(id('device:6a7b8c9d0e1f:brightness')), 75);
  // Badges only for created devices: the dimmer gets the last word (the digital
  // twin says disconnected) once created, then follows the readings.
  const badges = () =>
    gladys.fake.transports
      .filter((t) => t.device_external_id === id('device:6a7b8c9d0e1f'))
      .map((t) => t.transport);
  assert.deepEqual(badges(), []);
  await gladys.fake.deviceCreated(discovered.find((d) => d.name === 'Gradateur cuisine'));
  await settle();
  assert.deepEqual(badges(), ['unreachable']);
  device.emit('DevicesValuesReceived', [
    { deviceId: 111008, attribute: 'Disconnected', value: false, valueType: 'null' },
  ]);
  await settle();
  assert.deepEqual(badges(), ['unreachable', 'cloud']);

  device.emit('DevicesValuesReceived', F.deviceValues);
  await flush(app);
  assert.equal(gladys.fake.lastState(thermostat('setpoint')), 21);
  assert.equal(gladys.fake.lastState(thermostat('power')), 1500);
  assert.equal(gladys.fake.lastState(id('device:2a3b4c5d6e7f:state')), 1);
  assert.equal(gladys.fake.lastState(id('device:6a7b8c9d0e1f:brightness')), 42);

  // The stream pushes a new setpoint.
  server.streams[0].chunks.push(
    `event: next\ndata: ${JSON.stringify({ data: F.graphqlUpdate(19) })}\n\n`,
  );
  await flush(app);
  assert.equal(gladys.fake.lastState(thermostat('setpoint')), 19);
  assert.equal(gladys.fake.lastState(thermostat('power')), 1200);
  await app.stop();
});

test('the Discovery scan republishes; a device added on the hub joins', async () => {
  const { gladys, device, app } = await online();
  device.emit('DeviceAdded', {
    id: 111010,
    identifier: 'aa11bb22cc33',
    name: 'Prise garage',
    type: 'Outlet',
    supportedAttributesList: ['OnOff', 'Power'],
    settableAttributesList: ['OnOff'],
  });
  await settle();
  assert.ok(gladys.fake.discoveredDevices.some((d) => d.name === 'Prise garage'));
  const ack = await gladys.fake.scanRequest();
  assert.equal(ack, undefined);
  assert.equal(gladys.fake.discoveredDevices.length, 8);
  await app.stop();
});

test('commands: setpoint, on/off, brightness through PUT …/Attributes; read-only refused', async () => {
  const { gladys, server, app } = await online({ config: { language: 'en' } });
  const devices = gladys.fake.discoveredDevices;
  const thermo = devices.find((d) => d.name === 'Thermostat salon');
  const setpoint = thermo.features.find((f) => f.external_id.endsWith(':setpoint'));
  const ack = await gladys.fake.setValue(thermo, setpoint, 19.5);
  assert.equal(ack.success, true);
  const plug = devices.find((d) => d.name === 'Prise bureau');
  await gladys.fake.setValue(plug, plug.features[0], 0);
  const dimmer = devices.find((d) => d.name === 'Gradateur cuisine');
  await gladys.fake.setValue(
    dimmer,
    dimmer.features.find((f) => f.external_id.endsWith(':brightness')),
    30,
  );
  assert.deepEqual(server.attributes, [
    {
      path: '/Automation/v1/api/Locations/4051/Devices/111000/Attributes',
      json: { TargetTemperature: 19.5 },
    },
    { path: '/Automation/v1/api/Locations/4051/Devices/111004/Attributes', json: { OnOff: false } },
    {
      path: '/Automation/v1/api/Locations/4051/Devices/111008/Attributes',
      json: { Intensity: 0.3 },
    },
  ]);
  await flush(app);
  assert.equal(gladys.fake.lastState(thermostat('setpoint')), 19.5);
  assert.equal(gladys.fake.lastState(id('device:2a3b4c5d6e7f:state')), 0);
  const meter = devices.find((d) => d.name === 'SmartEnergyMeter');
  const refused = await gladys.fake.setValue(meter, meter.features[0], 5);
  assert.equal(refused.success, false);
  assert.match(refused.error, /cannot be set/);
  await app.stop();
});

test('a challenge from announcement to end: features, scene events, consumption requests', async () => {
  const { gladys, challengeHub, app, clock } = await online({
    config: { anticipation_hours: 2, challenge_lock: true },
  });
  challengeHub.emit('EventAdded', F.eventAdded);
  await settle();
  assert.deepEqual(challengeHub.sent.slice(2), [
    { method: 'SubscribeToChallenge', args: [{ locationId: F.LOCATION_ID, eventId: 354 }] },
    { method: 'SubscribeToEventCH', args: [{ locationHiloId: F.URN, eventId: 354 }] },
  ]);
  await flush(app);
  const events = () => gladys.fake.sceneEvents.map((e) => [e.key, e.data.phase ?? null]);
  // 18:00 UTC is within the 2 hours of anticipation before the 19:00 pre-heat.
  assert.deepEqual(events(), [
    ['challenge_announced', null],
    ['challenge_phase_started', 'anticipation'],
  ]);
  assert.equal(gladys.fake.sceneEvents[0].data.reduction_start, '2026-01-04T21:00:00.000Z');
  assert.match(gladys.fake.sceneEvents[0].data.reduction_start_local, /16 h 00/);
  assert.equal(gladys.fake.lastState(challenge('scheduled')), 1);
  assert.equal(gladys.fake.lastState(challenge('reduction')), 0);
  assert.match(
    gladys.fake.lastState(challenge('status')),
    /^Défi imminent : préchauffage à 14 h 00/,
  );
  assert.match(gladys.fake.lastState(challenge('reduction-start')), /4 janv\..*16 h 00/);
  // Rewards of the season (pre-season left out).
  assert.equal(gladys.fake.lastState(challenge('season-reward')), 13.77);

  clock.now = F.at('2026-01-04T19:00:00Z');
  await app.tick();
  await flush(app);
  assert.equal(gladys.fake.lastState(challenge('preheat')), 1);
  assert.match(gladys.fake.lastState(challenge('status')), /^Préchauffage jusqu'à 16 h 00/);

  clock.now = F.at('2026-01-04T21:00:30Z');
  await app.tick();
  challengeHub.emit('EventCHConsumptionUpdatedValuesReceived', F.eventConsumption);
  await flush(app);
  assert.ok(
    challengeHub.sent.some((s) => s.method === 'RequestEventCHConsumptionUpdate'),
    'consumption requested',
  );
  assert.equal(gladys.fake.lastState(challenge('reduction')), 1);
  assert.equal(gladys.fake.lastState(challenge('expected-reward')), 2.26);
  assert.equal(gladys.fake.lastState(challenge('baseline')), 45.058);
  assert.equal(gladys.fake.lastState(challenge('consumption')), 0.25);
  assert.match(gladys.fake.lastState(challenge('status')), /^Réduction jusqu'à 20 h 00/);

  // The lock: no setpoint change from Gladys during the reduction.
  const thermo = gladys.fake.discoveredDevices.find((d) => d.name === 'Thermostat salon');
  const locked = await gladys.fake.setValue(
    thermo,
    thermo.features.find((f) => f.external_id.endsWith(':setpoint')),
    23,
  );
  assert.equal(locked.success, false);
  assert.match(locked.error, /bloqués/);

  clock.now = F.at('2026-01-05T01:00:30Z');
  await app.tick();
  clock.now = F.at('2026-01-05T02:00:30Z');
  await app.tick();
  await flush(app);
  assert.deepEqual(events(), [
    ['challenge_announced', null],
    ['challenge_phase_started', 'anticipation'],
    ['challenge_phase_started', 'preheat'],
    ['challenge_phase_started', 'reduction'],
    ['challenge_phase_started', 'recovery'],
    ['challenge_ended', null],
  ]);
  const ended = gladys.fake.sceneEvents.at(-1).data;
  assert.equal(ended.reward, 2.26);
  assert.equal(ended.savings_kwh, 3.99);
  const reduction = gladys.fake.sceneEvents.find((e) => e.data.phase === 'reduction').data;
  assert.equal(reduction.phase_label, 'réduction');
  assert.equal(gladys.fake.lastState(challenge('scheduled')), 0);
  assert.equal(gladys.fake.lastState(challenge('last-reward')), 2.26);
  assert.equal(gladys.fake.lastState(challenge('status')), 'Aucun défi annoncé');
  await app.stop();
});

test('a restart in the middle of a challenge fires nothing again', async () => {
  const first = await online();
  first.challengeHub.emit('EventAdded', F.eventAdded);
  first.clock.now = F.at('2026-01-04T21:30:00Z');
  await first.app.tick();
  await flush(first.app);
  assert.deepEqual(
    first.gladys.fake.sceneEvents.map((e) => [e.key, e.data.phase ?? null]),
    [
      ['challenge_announced', null],
      ['challenge_phase_started', 'reduction'],
    ],
  );
  await first.app.stop();

  const second = await online({
    memory: first.store.data,
    now: F.at('2026-01-04T21:45:00Z'),
  });
  second.challengeHub.emit('EventListInitialValuesReceived', [F.eventAdded]);
  await flush(second.app);
  assert.deepEqual(second.gladys.fake.sceneEvents, []);
  assert.equal(second.gladys.fake.lastState(challenge('reduction')), 1);
  await second.app.stop();
});

test('energy: the power integrated into an index, kept across restarts', async () => {
  const { gladys, device, app, clock, store } = await online();
  device.emit('DevicesValuesReceived', F.deviceValues);
  await settle();
  clock.now = START + HOUR;
  await app.tick();
  await flush(app);
  assert.equal(gladys.fake.lastState(thermostat('energy')), 1.5);
  assert.equal(gladys.fake.lastState(id('device:0x006baa0000000001-smart_meter:energy')), 4.32);
  await app.stop();
  assert.equal(store.data.energy[thermostat('energy')], 1.5);
});

test('a device created in Gladys gets its values again', async () => {
  const { gladys, app } = await online();
  await flush(app);
  const thermo = gladys.fake.discoveredDevices.find((d) => d.name === 'Thermostat salon');
  const before = gladys.fake.states.length;
  await gladys.fake.deviceCreated(thermo);
  await flush(app);
  const resent = gladys.fake.states.slice(before).map((s) => s.device_feature_external_id);
  assert.ok(resent.includes(thermostat('temperature')));
  assert.ok(resent.includes(thermostat('setpoint')));
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices.at(-1));
  await flush(app);
  assert.ok(
    gladys.fake.states
      .slice(before)
      .some((s) => s.device_feature_external_id === challenge('status')),
  );
  await app.stop();
});

test('"Test the connection" sums up; "Sign out" forgets the tokens', async () => {
  const { gladys, store, app } = await online({ config: { language: 'en' } });
  const ack = await gladys.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.match(
    ack.data.message.en,
    /^Connected as client@example\.com, location Maison: 7 devices, live link up\. No challenge announced\.$/,
  );
  assert.match(ack.data.message.fr, /lien direct actif/);
  const out = await gladys.fake.action('sign_out', {});
  assert.equal(out.success, true);
  assert.equal(store.data.session, null);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  const after = await gladys.fake.action('test_connection', {});
  assert.equal(after.success, false);
  assert.match(after.error, /Not signed in/);
  await app.stop();
});

test('a refused refresh token: status, one scene event, everything stops', async () => {
  const { gladys, server, hubs, app, clock, store, timers } = await online();
  server.refuseRefresh = true;
  clock.now = START + 2 * HOUR;
  hubs.hub('/DeviceHub').close(new Error('Connection lost'));
  hubs.hub('/ChallengeHub').close(new Error('Connection lost'));
  await timers.runTimeouts();
  await flush(app);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /expired/);
  const lost = gladys.fake.sceneEvents.filter((e) => e.key === 'sign_in_needed');
  assert.equal(lost.length, 1);
  assert.equal(lost[0].data.email, F.EMAIL);
  assert.match(lost[0].data.reason, /AADB2C90080/);
  assert.equal(store.data.session, null);
  assert.equal(app.hubs, null);
  await app.stop();
});

test('Hilo unreachable: the status says it and it retries', async () => {
  const { gladys, server, app, timers } = await startApp({ memory: storedSession(START) });
  server.failLocations = 1;
  await app.goOnline();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Service Unavailable/);
  assert.equal(app.hubs, null);
  await timers.runTimeouts();
  await settle();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.notEqual(app.hubs, null);
  await app.stop();
});

test('a Flex D challenge subscribes to the Flex details', async () => {
  const { challengeHub, app } = await online();
  challengeHub.emit('EventFlexDetailsInitialValuesReceived', F.flexDetails);
  await settle();
  assert.ok(
    challengeHub.sent.some(
      (s) =>
        s.method === 'SubscribeToEventFlex' &&
        s.args[0].eventId === 355 &&
        s.args[0].locationHiloId === F.URN,
    ),
  );
  await app.stop();
});
