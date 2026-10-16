// -----------------------------------------------------------------------------
// HiloApp: the Hilo account in Gladys.
//
// - Sign-in: "Connect" (account_link) opens the Hilo sign-in page with a PKCE
//   challenge; "Finish the sign-in" takes the address of the page shown at
//   the end, exchanges its code, keeps the tokens in /data.
// - Online: the first location of the account (REST), the DeviceHub (device
//   list and values), the ChallengeHub (challenges), the GraphQL digital twin
//   (initial values, then the onAnyDeviceUpdated stream), the season rewards
//   (REST, every 6 hours and after a challenge).
// - A clock every minute (and at each phase change): energy indexes from the
//   power, challenge phase and features, scene events.
// - Commands: setpoint, on/off, brightness through PUT …/Attributes.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { authorizeUrl, createPkce, parseRedirect } from './auth.js';
import {
  ChallengeBook,
  anticipationMs,
  challengeEvents,
  kwh,
  phaseAt,
  rewardOf,
} from './challenges.js';
import { HiloClient, HiloError, SignInNeededError } from './client.js';
import { normalizeConfig } from './config.js';
import {
  ACCOUNT_FIELD,
  API,
  AUTH,
  CHALLENGE_TARGETS,
  DEVICE_TARGETS,
  HUB_METHODS,
  RATE_PLANS,
  SCENE_TRIGGERS,
  TIME_ZONE,
  TIMINGS,
} from './constants.js';
import {
  ATTRIBUTES,
  challengeIds,
  challengesDevice,
  commandOf,
  deviceIds,
  gladysDevice,
  parseExternalId,
  rolesOf,
  stateOf,
} from './devices.js';
import { EnergyMeters } from './energy.js';
import { QUERY_GET_LOCATION, SUBSCRIPTION_DEVICE_UPDATED } from './graphqlQueries.js';
import { createTransport } from './http.js';
import { Hub, createHubConnection } from './hubs.js';
import { ANSWERS, ERRORS, MESSAGES, PHASE_NAMES, STATUS_TEXTS, fill, word } from './i18n.js';
import {
  normalizeDevices,
  readingsFromHub,
  readingsFromList,
  readingsFromLocation,
  readingsFromSubscription,
} from './inventory.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory } from './store.js';
import { GraphqlSubscription } from './subscription.js';

const all = (...lists) => lists.flat();

/** A localized error the button or the scene shows. */
class UserError extends Error {
  constructor(texts, language, values) {
    super(word(fill(texts, values), language));
    this.name = 'UserError';
  }
}

export class HiloApp {
  constructor({
    gladys,
    logger,
    transport,
    userAgent,
    store = fileStore(),
    now = Date.now,
    timers = globalThis,
    createConnection = createHubConnection,
    random,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.store = store;
    this.now = now;
    this.timers = timers;
    this.createConnection = createConnection;
    this.random = random;
    this.transport = transport ?? createTransport({ userAgent });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null);
    this.client = new HiloClient({
      transport: this.transport,
      now,
      onSession: (session) => {
        this.memory.session = session;
        return this.save();
      },
    });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.book = new ChallengeBook();
    this.energy = new EnergyMeters();
    this.started = false;
    this.online = false;
    this.location = null;
    /** Hilo id -> normalized device */
    this.devices = new Map();
    /** hiloId (urn) -> Hilo id */
    this.hiloIds = new Map();
    /** Hilo id -> Map(attribute -> value) */
    this.readings = new Map();
    /** Gladys device external id -> transport */
    this.transports = new Map();
    this.hubs = null;
    this.subscription = null;
    this.subscribed = new Set();
    this.timer = undefined;
    this.phaseTimer = undefined;
    this.retryTimer = undefined;
    this.retryDelay = TIMINGS.reconnectBase;
    this.lastEnergySave = 0;
    this.lastConsumptionRequest = 0;
    this.lastSeasons = 0;
    this.seasonReward = undefined;
    this.losing = false;
    this.status = null;
    this.saving = Promise.resolve();
  }

  get language() {
    return this.config.language;
  }

  get anticipation() {
    return anticipationMs(this.config.anticipationHours);
  }

  // --- lifecycle --------------------------------------------------------------

  /** Every Gladys (re)connection. */
  async connected(rawConfig) {
    this.config = normalizeConfig(rawConfig);
    if (this.started) {
      if (this.status) {
        await this.setStatus(this.status.connected, this.status.message);
      }
      return;
    }
    this.started = true;
    this.memory = normalizeMemory(await this.store.load());
    this.energy = new EnergyMeters(this.memory.energy);
    this.client.setSession(this.memory.session);
    this.publisher.start();
    this.timer = this.timers.setInterval(() => {
      this.tick().catch((err) => this.logger.warn(`Clock: ${err.message}`));
    }, TIMINGS.tick);
    if (this.client.signedIn) {
      await this.goOnline();
    } else {
      await this.setStatus(
        false,
        this.memory.pending ? MESSAGES.signInPending : MESSAGES.notSignedIn,
      );
    }
  }

  async configUpdated(rawConfig) {
    this.config = normalizeConfig(rawConfig);
    await this.updateChallenges();
  }

  async stop() {
    this.started = false;
    if (this.timer) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.goOffline();
    this.publisher.stop();
    await this.publisher.flush().catch(() => {});
    this.memory.energy = this.energy.snapshot();
    await this.save();
  }

  save() {
    this.saving = this.saving
      .then(() => this.store.save(this.memory))
      .catch((err) => this.logger.warn(`Saving /data failed: ${err.message}`));
    return this.saving;
  }

  async setStatus(connected, texts, values) {
    const message = values ? fill(texts, values) : texts;
    this.status = { connected, message };
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      this.logger.warn(`Connection status not sent: ${err.message}`);
    }
  }

  get live() {
    return Boolean(this.hubs?.device.connected || this.subscription?.open);
  }

  // --- online / offline -------------------------------------------------------

  async goOnline() {
    if (this.retryTimer) {
      this.timers.clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    if (this.hubs || this.subscription) {
      await this.goOffline();
    }
    try {
      await this.setStatus(false, MESSAGES.connecting);
      const locations = await this.client.locations();
      const first = locations[0];
      if (!first) {
        await this.setStatus(false, MESSAGES.noLocation);
        return;
      }
      this.location = {
        id: first.id,
        urn: this.client.urn ?? first.locationHiloId ?? null,
        name: first.name ?? String(first.id),
      };
      this.online = true;
      this.startHubs();
      this.refreshSeasons().catch((err) => this.logger.warn(`Rewards: ${err.message}`));
      await this.updateChallenges();
      await this.setStatus(true, MESSAGES.connected, {
        email: this.memory.session?.email ?? '',
      });
      this.retryDelay = TIMINGS.reconnectBase;
    } catch (err) {
      await this.failed(err);
    }
  }

  /** A start that failed: a dead session waits for the user, anything else retries. */
  async failed(err) {
    if (err instanceof SignInNeededError) {
      await this.sessionLost(err);
      return;
    }
    this.logger.warn(`Hilo: ${err.message}`);
    await this.setStatus(false, MESSAGES.failed, { error: err.message });
    if (!this.started) {
      return;
    }
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, TIMINGS.reconnectMax);
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = undefined;
      this.goOnline();
    }, delay);
  }

  /** The refresh token was refused: everything stops until the user signs in again. */
  async sessionLost(err) {
    // The hubs and the stream all notice it: told once.
    if (this.losing) {
      return;
    }
    this.losing = true;
    this.logger.warn(`Hilo session lost: ${err.message}`);
    await this.goOffline();
    const email = this.memory.session?.email ?? null;
    this.memory.session = null;
    this.client.setSession(null);
    await this.save();
    await this.setStatus(false, MESSAGES.signInExpired);
    this.publisher.pushSceneEvent(SCENE_TRIGGERS.SIGN_IN_NEEDED, {
      email,
      reason: String(err.message ?? '').slice(0, 300),
    });
  }

  async goOffline() {
    this.online = false;
    for (const timer of ['phaseTimer', 'retryTimer']) {
      if (this[timer]) {
        this.timers.clearTimeout(this[timer]);
        this[timer] = undefined;
      }
    }
    const hubs = this.hubs;
    const subscription = this.subscription;
    this.hubs = null;
    this.subscription = null;
    this.energy.pause(this.now());
    await Promise.all([hubs?.device.stop(), hubs?.challenge.stop(), subscription?.stop()]);
  }

  /** SignalR wraps the errors of the token factory: the client remembers a dead session. */
  isFatal(err) {
    return err instanceof SignInNeededError || this.client.sessionDead;
  }

  startHubs() {
    const tokenFactory = () => this.client.accessToken();
    const make = (name, path, targets, onMessage, onConnected) =>
      new Hub({
        name,
        url: this.client.hubUrl(path),
        headers: this.client.hubHeaders(path),
        accessTokenFactory: tokenFactory,
        targets,
        onMessage,
        onConnected,
        onDisconnected: () => this.energy.pause(this.now()),
        isFatal: (err) => this.isFatal(err),
        onFatal: (err) => this.sessionLost(err),
        createConnection: this.createConnection,
        logger: this.logger,
        timers: this.timers,
      });
    this.hubs = {
      device: make(
        'DeviceHub',
        API.deviceHub,
        all(
          DEVICE_TARGETS.list,
          DEVICE_TARGETS.added,
          DEVICE_TARGETS.values,
          DEVICE_TARGETS.ignored,
        ),
        (target, args) => this.deviceMessage(target, args),
        () => this.deviceHubConnected(),
      ),
      challenge: make(
        'ChallengeHub',
        API.challengeHub,
        all(
          CHALLENGE_TARGETS.list,
          CHALLENGE_TARGETS.listUpdate,
          CHALLENGE_TARGETS.added,
          CHALLENGE_TARGETS.details,
          CHALLENGE_TARGETS.consumption,
          CHALLENGE_TARGETS.ignored,
        ),
        (target, args) => this.challengeMessage(target, args),
        () => this.challengeHubConnected(),
      ),
    };
    this.hubs.device.start();
    this.hubs.challenge.start();
  }

  // --- DeviceHub ----------------------------------------------------------------

  async deviceHubConnected() {
    await this.hubs?.device.send(HUB_METHODS.subscribeToLocation, this.location.id);
  }

  deviceMessage(target, args) {
    const [payload] = args;
    if (DEVICE_TARGETS.list.includes(target)) {
      this.deviceList(payload, true);
    } else if (DEVICE_TARGETS.added.includes(target)) {
      this.deviceList([payload], false);
    } else if (DEVICE_TARGETS.values.includes(target)) {
      this.applyReadings(readingsFromHub(payload));
    }
  }

  /** A device list (all of them, or one added): kept, published to Discovery. */
  deviceList(rawList, complete) {
    const devices = normalizeDevices(rawList);
    if (complete) {
      this.devices.clear();
      this.hiloIds.clear();
    }
    for (const device of devices) {
      this.devices.set(device.id, device);
      if (device.hiloId) {
        this.hiloIds.set(device.hiloId, device.id);
      }
    }
    this.applyReadings(readingsFromList(rawList));
    this.publishDiscovered().catch((err) =>
      this.logger.warn(`Discovered devices not sent: ${err.message}`),
    );
    // The digital twin speaks hiloIds: started once the list maps them.
    this.startGraphql();
  }

  // --- GraphQL ------------------------------------------------------------------

  startGraphql() {
    if (!this.location?.urn || this.subscription) {
      return;
    }
    const variables = { locationHiloId: this.location.urn };
    this.readLocation().catch((err) => this.logger.debug(`GraphQL location: ${err.message}`));
    this.subscription = new GraphqlSubscription({
      client: this.client,
      query: SUBSCRIPTION_DEVICE_UPDATED,
      variables,
      onData: (data) => this.applyReadings(readingsFromSubscription(data)),
      onReconnected: () => this.readLocation(),
      isFatal: (err) => this.isFatal(err),
      onFatal: (err) => this.sessionLost(err),
      logger: this.logger,
      timers: this.timers,
    });
    this.subscription.start();
  }

  async readLocation() {
    if (!this.location?.urn) {
      return;
    }
    const data = await this.client.graphql(QUERY_GET_LOCATION, {
      locationHiloId: this.location.urn,
    });
    this.applyReadings(readingsFromLocation(data));
  }

  // --- readings -> states -----------------------------------------------------------

  deviceOf(reading) {
    if (reading.deviceId !== null && this.devices.has(reading.deviceId)) {
      return this.devices.get(reading.deviceId);
    }
    const id = reading.hiloId ? this.hiloIds.get(reading.hiloId) : undefined;
    return id === undefined ? undefined : this.devices.get(id);
  }

  /** The external ids of the devices the user created (badges only go to those). */
  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((device) => device.external_id));
  }

  applyReadings(readings) {
    const now = this.now();
    const transports = [];
    const created = this.createdDevices();
    for (const reading of readings) {
      const device = this.deviceOf(reading);
      if (!device) {
        continue;
      }
      const values = this.readings.get(device.id) ?? new Map();
      values.set(reading.attribute, reading.value);
      this.readings.set(device.id, values);
      const ids = deviceIds(this.gladys, device);
      if (reading.attribute === 'Disconnected') {
        const transport = reading.value ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.CLOUD;
        if (this.transports.get(ids.device) !== transport) {
          this.transports.set(ids.device, transport);
          // Kept for the device created later (republishDevice sends it then).
          if (created.has(ids.device)) {
            transports.push({ external_id: ids.device, transport });
          }
        }
        continue;
      }
      const roles = rolesOf(device);
      if (reading.attribute === 'Power' && roles.includes('energy')) {
        this.energy.power(ids.feature('energy'), reading.value, now, this.live);
      }
      for (const role of roles) {
        const state = stateOf(role, reading.attribute, reading.value);
        if (state) {
          this.publisher.push(ids.feature(role), state);
        }
      }
    }
    if (transports.length > 0) {
      this.gladys
        .publishTransports(transports)
        .catch((err) => this.logger.debug(`Badges not sent: ${err.message}`));
    }
  }

  /** Every known value of one device again (created in Gladys, which had none). */
  republishDevice(device) {
    const ids = deviceIds(this.gladys, device);
    const values = this.readings.get(device.id) ?? new Map();
    for (const role of rolesOf(device)) {
      if (role === 'energy') {
        const value = this.energy.value(ids.feature('energy'));
        if (value !== undefined) {
          this.publisher.push(ids.feature('energy'), { state: value });
        }
        continue;
      }
      const attribute = ATTRIBUTES[role];
      if (values.has(attribute)) {
        const state = stateOf(role, attribute, values.get(attribute));
        if (state) {
          this.publisher.push(ids.feature(role), state);
        }
      }
    }
    const transport = this.transports.get(ids.device);
    if (transport) {
      this.gladys
        .publishTransports([{ external_id: ids.device, transport }])
        .catch((err) => this.logger.debug(`Badge not sent: ${err.message}`));
    }
  }

  /** The energy indexes, at most once a minute (publishChangedStates skips the same values). */
  publishEnergy() {
    for (const device of this.devices.values()) {
      if (!rolesOf(device).includes('energy')) {
        continue;
      }
      const id = deviceIds(this.gladys, device).feature('energy');
      const value = this.energy.value(id);
      if (value !== undefined) {
        this.publisher.push(id, { state: value });
      }
    }
  }

  setpointRange(device) {
    const values = this.readings.get(device.id);
    const min = values?.get('MinTempSetpoint');
    const max = values?.get('MaxTempSetpoint');
    return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > min
      ? { min, max }
      : undefined;
  }

  gladysDevices() {
    const list = [];
    for (const device of this.devices.values()) {
      const built = gladysDevice(this.gladys, device, {
        language: this.language,
        setpointRange: this.setpointRange(device),
      });
      if (built) {
        list.push(built);
      }
    }
    if (this.location) {
      list.push(challengesDevice(this.gladys, this.location.id, this.language));
    }
    return list;
  }

  async publishDiscovered() {
    await this.gladys.publishDiscoveredDevices(this.gladysDevices());
  }

  async scan() {
    if (!this.client.signedIn) {
      throw new UserError(ERRORS.notSignedIn, this.language);
    }
    await this.publishDiscovered();
  }

  async deviceCreated(gladysDevice) {
    const parsed = parseExternalId(gladysDevice?.external_id);
    if (!parsed) {
      return;
    }
    if (parsed.kind === 'challenges') {
      this.publishChallengeStates();
      return;
    }
    const device = [...this.devices.values()].find((d) => d.key === parsed.key);
    if (device) {
      this.republishDevice(device);
    }
  }

  async deviceDeleted(gladysDevice) {
    if (gladysDevice?.external_id) {
      this.publisher.forget(gladysDevice.external_id);
    }
  }

  // --- commands ---------------------------------------------------------------------

  async setValue(_device, feature, value) {
    const parsed = parseExternalId(feature?.external_id);
    const device =
      parsed?.kind === 'device'
        ? [...this.devices.values()].find((d) => d.key === parsed.key)
        : undefined;
    if (!device) {
      throw new UserError(ERRORS.unknownDevice, this.language);
    }
    const command = commandOf(parsed.role, value);
    if (!command || !device.settable.has(command.attribute)) {
      throw new UserError(ERRORS.readOnly, this.language);
    }
    if (!this.online || !this.location) {
      throw new UserError(ERRORS.notReady, this.language);
    }
    if (parsed.role === 'setpoint' && this.config.challengeLock && this.inReduction()) {
      throw new UserError(ERRORS.challengeLock, this.language);
    }
    await this.client.setAttribute(this.location.id, device.id, command.attribute, command.value);
    // Shown at once; Hilo pushes the value back through the hub or the stream.
    const values = this.readings.get(device.id) ?? new Map();
    values.set(command.attribute, command.value);
    this.readings.set(device.id, values);
    const ids = deviceIds(this.gladys, device);
    for (const role of rolesOf(device)) {
      const state = stateOf(role, command.attribute, command.value);
      if (state) {
        this.publisher.pushEvent(ids.feature(role), state);
      }
    }
  }

  inReduction() {
    const current = this.book.current(this.now());
    return current ? phaseAt(current, this.now()) === 'reduction' : false;
  }

  // --- ChallengeHub ---------------------------------------------------------------------

  async challengeHubConnected() {
    this.subscribed.clear();
    const hub = this.hubs?.challenge;
    await hub?.send(HUB_METHODS.subscribeToChallengeList, { locationId: this.location.id });
    if (this.location.urn) {
      await hub?.send(HUB_METHODS.subscribeToEventList, { locationHiloId: this.location.urn });
    }
    for (const challenge of this.book.all()) {
      await this.subscribeChallenge(challenge);
    }
  }

  ratePlanOf(challenge) {
    if (challenge?.ratePlan) {
      return challenge.ratePlan;
    }
    return this.config.ratePlan === RATE_PLANS.auto ? RATE_PLANS.ch : this.config.ratePlan;
  }

  /** The details of one challenge (legacy and per-rate methods, as Home Assistant). */
  async subscribeChallenge(challenge) {
    if (!challenge || this.subscribed.has(challenge.id)) {
      return;
    }
    if (phaseAt(challenge, this.now()) === 'completed' && challenge.report) {
      return;
    }
    const hub = this.hubs?.challenge;
    if (!hub?.connected) {
      return;
    }
    this.subscribed.add(challenge.id);
    await hub.send(HUB_METHODS.subscribeToChallenge, {
      locationId: this.location.id,
      eventId: challenge.id,
    });
    if (this.location.urn) {
      const method =
        this.ratePlanOf(challenge) === RATE_PLANS.flex
          ? HUB_METHODS.subscribeToEventFlex
          : HUB_METHODS.subscribeToEventCH;
      await hub.send(method, { locationHiloId: this.location.urn, eventId: challenge.id });
    }
  }

  async requestConsumption(challenge) {
    const hub = this.hubs?.challenge;
    if (!challenge || !hub?.connected) {
      return;
    }
    await hub.send(HUB_METHODS.requestChallengeConsumption, {
      locationId: this.location.id,
      eventId: challenge.id,
    });
    if (this.location.urn) {
      const method =
        this.ratePlanOf(challenge) === RATE_PLANS.flex
          ? HUB_METHODS.requestEventFlexConsumption
          : HUB_METHODS.requestEventCHConsumption;
      await hub.send(method, { locationHiloId: this.location.urn, eventId: challenge.id });
    }
  }

  challengeMessage(target, args) {
    const [payload] = args;
    const now = this.now();
    let touched;
    if (CHALLENGE_TARGETS.list.includes(target)) {
      this.book.applyList(payload, now);
      touched = this.book.all();
    } else if (
      CHALLENGE_TARGETS.added.includes(target) ||
      CHALLENGE_TARGETS.listUpdate.includes(target) ||
      CHALLENGE_TARGETS.details.includes(target)
    ) {
      touched = this.book.applyChallenges(payload, now);
    } else if (CHALLENGE_TARGETS.consumption.includes(target)) {
      const challenge = this.book.applyConsumption(payload, now);
      touched = challenge ? [challenge] : [];
    } else {
      return;
    }
    // The 2025-26 messages name the rate (EventCH…, EventFlex…) when the body does not.
    const plan = target.startsWith('EventFlex')
      ? RATE_PLANS.flex
      : target.startsWith('EventCH')
        ? RATE_PLANS.ch
        : undefined;
    for (const challenge of touched) {
      if (plan && !challenge.ratePlan) {
        this.book.upsert({ id: challenge.id, phases: {}, consumption: {}, ratePlan: plan }, now);
      }
      this.subscribeChallenge(this.book.get(challenge.id) ?? challenge).catch(() => {});
    }
    this.updateChallenges().catch((err) => this.logger.warn(`Challenges: ${err.message}`));
  }

  formatLocal(ms, parts = 'full') {
    if (!Number.isFinite(ms)) {
      return null;
    }
    const locale = this.language === 'en' ? 'en-CA' : 'fr-CA';
    const options =
      parts === 'time'
        ? { hour: '2-digit', minute: '2-digit' }
        : parts === 'date'
          ? { weekday: 'short', day: 'numeric', month: 'short' }
          : {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            };
    return new Intl.DateTimeFormat(locale, { timeZone: TIME_ZONE, ...options }).format(ms);
  }

  statusText(challenge, phase) {
    if (!challenge) {
      return word(STATUS_TEXTS.none, this.language);
    }
    const p = challenge.phases;
    const sameDay =
      this.formatLocal(p.reductionStart, 'date') === this.formatLocal(p.reductionEnd, 'date');
    const values = {
      date: this.formatLocal(p.reductionStart, 'date'),
      preheat: this.formatLocal(p.preheatStart, 'time'),
      start: this.formatLocal(p.reductionStart, 'time'),
      end: sameDay ? this.formatLocal(p.reductionEnd, 'time') : this.formatLocal(p.reductionEnd),
      until: this.formatLocal(p.recoveryEnd, 'time'),
    };
    const texts = STATUS_TEXTS[phase] ?? STATUS_TEXTS.scheduled;
    return word(fill(texts, values), this.language);
  }

  /** The features of the challenges device (publishChangedStates skips the same values). */
  publishChallengeStates() {
    if (!this.location) {
      return;
    }
    const now = this.now();
    const ids = challengeIds(this.gladys, this.location.id);
    const current = this.book.current(now);
    const phase = current ? phaseAt(current, now, this.anticipation) : 'none';
    const flag = (on) => ({ state: on ? 1 : 0 });
    const push = (role, value) => this.publisher.push(ids.feature(role), value);
    push('status', { text: this.statusText(current, phase) });
    push('scheduled', flag(Boolean(current)));
    push('preheat', flag(phase === 'preheat'));
    push('reduction', flag(phase === 'reduction'));
    push('recovery', flag(phase === 'recovery'));
    push('reduction-start', { text: this.formatLocal(current?.phases.reductionStart) ?? '—' });
    push('reduction-end', { text: this.formatLocal(current?.phases.reductionEnd) ?? '—' });
    const last = this.book.lastEnded(now);
    const shown = current && phase !== 'scheduled' && phase !== 'anticipation' ? current : last;
    const consumption = shown?.consumption ?? {};
    if (Number.isFinite(consumption.reward)) {
      push('expected-reward', { state: consumption.reward });
    }
    const lastReward = rewardOf(last);
    if (Number.isFinite(lastReward)) {
      push('last-reward', { state: lastReward });
    }
    if (Number.isFinite(this.seasonReward)) {
      push('season-reward', { state: this.seasonReward });
    }
    if (Number.isFinite(consumption.baselineWh)) {
      push('baseline', { state: kwh(consumption.baselineWh) });
    }
    if (Number.isFinite(consumption.currentWh)) {
      push('consumption', { state: kwh(consumption.currentWh) });
    }
  }

  /** Phase, features, scene events, and the timer of the next phase change. */
  async updateChallenges() {
    const now = this.now();
    this.book.prune(now);
    const { events, memory } = challengeEvents(this.book, this.memory.challenges, now, {
      anticipation: this.anticipation,
      format: (ms) => this.formatLocal(ms),
    });
    const keys = {
      announced: SCENE_TRIGGERS.CHALLENGE_ANNOUNCED,
      phase: SCENE_TRIGGERS.PHASE_STARTED,
      ended: SCENE_TRIGGERS.CHALLENGE_ENDED,
    };
    for (const event of events) {
      const data = { ...event.data };
      if (event.key === 'phase') {
        data.phase_label = word(PHASE_NAMES[data.phase], this.language);
      }
      this.publisher.pushSceneEvent(keys[event.key], data);
      if (event.key === 'ended') {
        this.timers.setTimeout(
          () => this.refreshSeasons().catch(() => {}),
          TIMINGS.consumptionRequest,
        );
      }
    }
    if (JSON.stringify(memory) !== JSON.stringify(this.memory.challenges)) {
      this.memory.challenges = memory;
      await this.save();
    }
    this.publishChallengeStates();
    this.armPhaseTimer(now);
  }

  armPhaseTimer(now) {
    if (this.phaseTimer) {
      this.timers.clearTimeout(this.phaseTimer);
      this.phaseTimer = undefined;
    }
    const next = this.book.nextChange(now, this.anticipation);
    if (next === null || !this.started) {
      return;
    }
    // Within the minute of the clock: the clock takes it.
    const delay = next - now + 500;
    if (delay < TIMINGS.tick) {
      this.phaseTimer = this.timers.setTimeout(() => {
        this.phaseTimer = undefined;
        this.updateChallenges().catch((err) => this.logger.warn(`Challenges: ${err.message}`));
      }, delay);
    }
  }

  async refreshSeasons() {
    const urn = this.location?.urn;
    if (!urn) {
      return;
    }
    this.lastSeasons = this.now();
    const seasons = await this.client.seasons(urn);
    const latest = seasons.reduce(
      (best, season) => (!best || Number(season.season) > Number(best.season) ? season : best),
      null,
    );
    if (latest) {
      // Home Assistant's "totalReward": the season's rewards, pre-season events left out.
      this.seasonReward =
        Math.round(
          latest.events
            .filter((e) => Number.isFinite(e?.reward) && !e.isPreseasonEvent)
            .reduce((sum, e) => sum + e.reward, 0) * 100,
        ) / 100;
      this.publishChallengeStates();
    }
  }

  // --- clock ------------------------------------------------------------------------

  async tick() {
    const now = this.now();
    this.energy.tick(now, this.live);
    this.publishEnergy();
    if (now - this.lastEnergySave >= TIMINGS.energySave) {
      this.lastEnergySave = now;
      this.memory.energy = this.energy.snapshot();
      await this.save();
    }
    if (!this.online) {
      return;
    }
    await this.updateChallenges();
    const current = this.book.current(now);
    const phase = current ? phaseAt(current, now) : 'none';
    if (
      (phase === 'preheat' || phase === 'reduction') &&
      now - this.lastConsumptionRequest >= TIMINGS.consumptionRequest
    ) {
      this.lastConsumptionRequest = now;
      await this.requestConsumption(current);
    }
    if (now - this.lastSeasons >= TIMINGS.seasonsRefresh) {
      this.refreshSeasons().catch((err) => this.logger.warn(`Rewards: ${err.message}`));
    }
  }

  // --- sign-in and buttons ------------------------------------------------------------

  /** "Connect" (account_link): the Hilo sign-in page, a new PKCE pair kept in /data. */
  async authorizeUrl(key) {
    if (key !== ACCOUNT_FIELD) {
      throw new Error(`Unknown account field ${key}`);
    }
    const pkce = createPkce(this.random);
    this.memory.pending = { verifier: pkce.verifier, state: pkce.state, createdAt: this.now() };
    await this.save();
    if (!this.client.signedIn) {
      await this.setStatus(false, MESSAGES.signInPending);
    }
    return authorizeUrl(pkce);
  }

  /** "Finish the sign-in": the pasted address -> tokens -> online. */
  async finishSignIn(fields) {
    const parsed = parseRedirect(fields?.redirect_url);
    if (parsed.error === 'empty') {
      throw new UserError(ERRORS.emptyAddress, this.language);
    }
    if (parsed.error === 'refused') {
      throw new UserError(ERRORS.refused, this.language, { reason: parsed.description });
    }
    if (parsed.error) {
      throw new UserError(ERRORS.invalidAddress, this.language);
    }
    const pending = this.memory.pending;
    if (!pending || this.now() - pending.createdAt > AUTH.pendingTtl) {
      throw new UserError(ERRORS.noPendingSignIn, this.language);
    }
    if (parsed.state !== undefined && parsed.state !== pending.state) {
      throw new UserError(ERRORS.stateMismatch, this.language);
    }
    let session;
    try {
      session = await this.client.exchangeCode(parsed.code, pending.verifier);
    } catch (err) {
      if (err instanceof SignInNeededError) {
        throw new UserError(ERRORS.codeRefused, this.language, { reason: err.message });
      }
      throw err;
    }
    this.memory.pending = null;
    this.memory.session = session;
    this.losing = false;
    await this.save();
    this.goOnline().catch((err) => this.logger.warn(`Hilo: ${err.message}`));
    return fill(ANSWERS.signedIn, { email: session.email ?? '' });
  }

  async testConnection() {
    if (!this.client.signedIn) {
      throw new UserError(ERRORS.notSignedIn, this.language);
    }
    try {
      const locations = await this.client.locations();
      const first = locations[0];
      if (!first) {
        return MESSAGES.noLocation;
      }
      const now = this.now();
      const current = this.book.current(now);
      const challenge = current
        ? fill(ANSWERS.nextChallenge, {
            status: this.statusText(current, phaseAt(current, now, this.anticipation)),
          })
        : ANSWERS.noChallenge;
      const hubsUp = Boolean(this.hubs?.device.connected && this.hubs?.challenge.connected);
      const answer = {};
      for (const language of Object.keys(ANSWERS.test)) {
        const values = {
          email: this.memory.session?.email ?? '?',
          location: first.name ?? first.id,
          devices: this.devices.size,
          hubs: word(hubsUp ? ANSWERS.hubsUp : ANSWERS.hubsDownShort, language),
          challenge: word(challenge, language),
        };
        answer[language] = word(fill(ANSWERS.test, values), language);
      }
      return answer;
    } catch (err) {
      if (err instanceof SignInNeededError) {
        await this.sessionLost(err);
        throw new UserError(MESSAGES.signInExpired, this.language);
      }
      if (err instanceof HiloError) {
        throw new UserError(MESSAGES.failed, this.language, { error: err.message });
      }
      throw err;
    }
  }

  async signOut() {
    await this.goOffline();
    this.memory.session = null;
    this.memory.pending = null;
    this.client.setSession(null);
    await this.save();
    await this.setStatus(false, MESSAGES.notSignedIn);
    return ANSWERS.signedOut;
  }
}
