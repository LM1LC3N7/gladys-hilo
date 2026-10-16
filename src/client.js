// -----------------------------------------------------------------------------
// The Hilo account: the session (access token renewed with the refresh token,
// one new token and one retry on a 401) and every REST and GraphQL request.
// Hosts, headers and paths as python-hilo 2026.10.1 (pyhilo/api.py,
// pyhilo/graphql.py, MIT License, Copyright (c) 2020-2024 David Vallee
// Delisle): the API Management key on api.hiloenergie.com except the
// ChallengeHub (python-hilo removes it there: 401 otherwise), a bearer token
// everywhere.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { API, AUTH, TIMINGS } from './constants.js';
import { codeGrant, refreshGrant, sessionFromTokens } from './auth.js';

export class HiloError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'HiloError';
    this.status = status;
    this.code = code;
  }
}

/** The session is gone (refused refresh token, never signed in): a new sign-in is needed. */
export class SignInNeededError extends HiloError {
  constructor(message, options) {
    super(message, options);
    this.name = 'SignInNeededError';
  }
}

const describe = (answer) => {
  const body = answer.json;
  const text =
    body?.error_description ??
    body?.error?.message ??
    body?.message ??
    body?.error ??
    answer.text?.slice(0, 200);
  return typeof text === 'string' && text !== '' ? text : `HTTP ${answer.status}`;
};

/** The SHA-256 of a GraphQL document, the key of an automatic persisted query. */
export const persistedQueryHash = (query) => createHash('sha256').update(query).digest('hex');

export class HiloClient {
  constructor({ transport, now = Date.now, onSession = async () => {} }) {
    this.transport = transport;
    this.now = now;
    this.onSession = onSession;
    this.session = null;
    this.refreshing = undefined;
    // Set when Hilo refused the refresh token: nothing works until a new sign-in.
    this.sessionDead = false;
  }

  setSession(session) {
    this.session = session;
    this.sessionDead = false;
  }

  get signedIn() {
    return Boolean(this.session?.refreshToken || this.session?.accessToken);
  }

  // --- tokens ---------------------------------------------------------------

  async tokenRequest(form) {
    const answer = await this.transport.request({
      method: 'POST',
      url: `https://${AUTH.host}${AUTH.tokenPath}`,
      form,
    });
    if (answer.status >= 200 && answer.status < 300 && answer.json?.access_token) {
      return answer.json;
    }
    const code = answer.json?.error;
    const message = describe(answer);
    // B2C answers 400 invalid_grant to an expired, revoked or reused code or token.
    if (answer.status === 400 || answer.status === 401 || code === 'invalid_grant') {
      throw new SignInNeededError(message, { status: answer.status, code });
    }
    throw new HiloError(message, { status: answer.status, code });
  }

  /** Exchanges the code of the pasted address for the first tokens. */
  async exchangeCode(code, verifier) {
    const tokens = await this.tokenRequest(codeGrant(code, verifier));
    const session = sessionFromTokens(tokens, this.now());
    if (!session?.refreshToken) {
      throw new HiloError('Hilo returned no refresh token');
    }
    this.session = session;
    this.sessionDead = false;
    await this.onSession(session);
    return session;
  }

  /** Renews the access token (one at a time). */
  refresh() {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  async doRefresh() {
    const refreshToken = this.session?.refreshToken;
    if (!refreshToken) {
      this.sessionDead = true;
      throw new SignInNeededError('Not signed in to Hilo');
    }
    let tokens;
    try {
      tokens = await this.tokenRequest(refreshGrant(refreshToken));
    } catch (err) {
      if (err instanceof SignInNeededError) {
        this.sessionDead = true;
      }
      throw err;
    }
    this.session = sessionFromTokens(tokens, this.now(), this.session);
    await this.onSession(this.session);
    return this.session;
  }

  /** A valid access token, renewed shortly before its end. */
  async accessToken() {
    if (!this.session) {
      throw new SignInNeededError('Not signed in to Hilo');
    }
    if (
      !this.session.accessToken ||
      this.now() >= (this.session.expiresAt ?? 0) - TIMINGS.tokenMargin
    ) {
      await this.refresh();
    }
    return this.session.accessToken;
  }

  get urn() {
    return this.session?.urn ?? null;
  }

  // --- REST -----------------------------------------------------------------

  async api(method, path, { json, subscriptionKey = true, host = API.host } = {}) {
    let retried = false;
    for (;;) {
      const token = await this.accessToken();
      const headers = { authorization: `Bearer ${token}` };
      if (subscriptionKey) {
        headers['ocp-apim-subscription-key'] = API.subscriptionKey;
      }
      const answer = await this.transport.request({
        method,
        url: `https://${host}${path}`,
        headers,
        json,
      });
      if (answer.status === 401 && !retried) {
        retried = true;
        await this.refresh();
        continue;
      }
      if (answer.status < 200 || answer.status >= 300) {
        throw new HiloError(describe(answer), { status: answer.status });
      }
      return answer.json;
    }
  }

  /** The locations of the account: [{ id, locationHiloId, name, … }]. */
  async locations() {
    const answer = await this.api('GET', API.locations);
    return Array.isArray(answer) ? answer : [];
  }

  /** Sets one attribute of a device (`{ TargetTemperature: 21 }`, `{ OnOff: true }`…). */
  async setAttribute(locationId, deviceId, attribute, value) {
    await this.api('PUT', API.deviceAttributes(locationId, deviceId), {
      json: { [attribute]: value },
    });
  }

  /** The challenge seasons and their events (rewards), as python-hilo get_seasons. */
  async seasons(urn) {
    const summary = await this.api('GET', API.seasons(urn));
    const seasons = [];
    for (const entry of Array.isArray(summary) ? summary : []) {
      if (entry?.season === undefined || !entry.ratePlan) {
        continue;
      }
      const events = await this.api(
        'GET',
        API.seasonEvents(urn, entry.ratePlan, entry.season, entry.periodId ?? ''),
      );
      seasons.push({
        season: entry.season,
        ratePlan: entry.ratePlan,
        events: Array.isArray(events?.events) ? events.events : Array.isArray(events) ? events : [],
      });
    }
    return seasons;
  }

  /** The negotiate URL of a hub, for the SignalR client (it follows the Azure redirect). */
  hubUrl(path) {
    return `https://${API.host}${path}`;
  }

  /** The headers of a hub negotiation: the subscription key on the DeviceHub only. */
  hubHeaders(path) {
    return path === API.challengeHub ? {} : { 'ocp-apim-subscription-key': API.subscriptionKey };
  }

  // --- GraphQL --------------------------------------------------------------

  graphqlPayload(query, variables, withQuery) {
    const payload = {
      extensions: { persistedQuery: { version: 1, sha256Hash: persistedQueryHash(query) } },
      variables,
    };
    if (withQuery) {
      payload.query = query;
    }
    return payload;
  }

  /**
   * One GraphQL query: sent as a persisted query, sent again with its text
   * when the server does not know it yet (PersistedQueryNotFound).
   */
  async graphql(query, variables) {
    let withQuery = false;
    let retried = false;
    for (;;) {
      const token = await this.accessToken();
      const answer = await this.transport.request({
        method: 'POST',
        url: `https://${API.graphqlHost}${API.graphqlPath}`,
        headers: { authorization: `Bearer ${token}` },
        json: this.graphqlPayload(query, variables, withQuery),
      });
      if (answer.status === 401 && !retried) {
        retried = true;
        await this.refresh();
        continue;
      }
      const errors = answer.json?.errors;
      if (
        !withQuery &&
        Array.isArray(errors) &&
        errors.some((e) => e?.message === 'PersistedQueryNotFound')
      ) {
        withQuery = true;
        continue;
      }
      if (answer.status < 200 || answer.status >= 300) {
        throw new HiloError(describe(answer), { status: answer.status });
      }
      if (Array.isArray(errors) && errors.length > 0) {
        throw new HiloError(`GraphQL: ${errors.map((e) => e?.message).join(', ')}`);
      }
      return answer.json?.data ?? {};
    }
  }

  /** Opens the GraphQL subscription stream (Server-Sent Events). */
  async graphqlStream(query, variables, { withQuery = false, signal } = {}) {
    const token = await this.accessToken();
    return this.transport.stream({
      method: 'POST',
      url: `https://${API.graphqlHost}${API.graphqlPath}`,
      headers: { authorization: `Bearer ${token}` },
      json: this.graphqlPayload(query, variables, withQuery),
      signal,
    });
  }
}
