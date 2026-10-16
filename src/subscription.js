// -----------------------------------------------------------------------------
// The GraphQL subscription of the Hilo digital twin (`onAnyDeviceUpdated`):
// one POST answered by a stream of Server-Sent Events, as python-hilo
// 2026.10.1 (pyhilo/graphql.py, MIT License, Copyright (c) 2020-2024 David
// Vallee Delisle) reads it:
// - sent as a persisted query, sent again with its text on
//   PersistedQueryNotFound;
// - a stream silent for 180 s is restarted;
// - reconnection 5 s doubling to 5 minutes, reset once data flowed; after a
//   reconnection the location is read again (values missed meanwhile).
// -----------------------------------------------------------------------------

import { TIMINGS } from './constants.js';

/**
 * Splits a Server-Sent Events buffer into complete events
 * ({ event, data }) and the unfinished rest.
 */
export function parseSse(buffer) {
  const events = [];
  const normalized = buffer.replace(/\r\n?/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop();
  for (const block of blocks) {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (line === '' || line.startsWith(':')) {
        continue;
      }
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') {
        event = value;
      } else if (field === 'data') {
        data.push(value);
      }
    }
    if (data.length > 0 || event !== 'message') {
      events.push({ event, data: data.join('\n') });
    }
  }
  return { events, rest };
}

const notFound = (payload) =>
  Array.isArray(payload?.errors) &&
  payload.errors.some((e) => e?.message === 'PersistedQueryNotFound');

export class GraphqlSubscription {
  constructor({
    client,
    query,
    variables,
    onData,
    onReconnected = async () => {},
    onFatal = () => {},
    isFatal = () => false,
    logger,
    timers = globalThis,
  }) {
    this.client = client;
    this.query = query;
    this.variables = variables;
    this.onData = onData;
    this.onReconnected = onReconnected;
    this.onFatal = onFatal;
    this.isFatal = isFatal;
    this.logger = logger;
    this.timers = timers;
    this.stopped = true;
    this.open = false;
    this.withQuery = false;
    this.retryWithQuery = false;
    this.delay = TIMINGS.reconnectBase;
    this.timer = undefined;
    this.wake = undefined;
    this.controller = undefined;
    this.watchdog = undefined;
    this.runs = 0;
    this.running = undefined;
  }

  start() {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.running = this.run();
  }

  async run() {
    while (!this.stopped) {
      let flowed = false;
      try {
        flowed = await this.once();
      } catch (err) {
        if (this.stopped) {
          break;
        }
        if (this.isFatal(err)) {
          this.logger.warn(`GraphQL: ${err.message}`);
          this.onFatal(err);
          break;
        }
        this.logger.debug(`GraphQL stream lost: ${err.message}`);
      } finally {
        this.open = false;
        this.clearWatchdog();
      }
      if (this.stopped) {
        break;
      }
      if (this.retryWithQuery) {
        this.retryWithQuery = false;
        continue;
      }
      if (flowed) {
        this.delay = TIMINGS.reconnectBase;
      }
      await this.sleep(this.delay);
      this.delay = Math.min(this.delay * 2, TIMINGS.reconnectMax);
      this.withQuery = false;
      if (!this.stopped) {
        try {
          await this.onReconnected();
        } catch (err) {
          this.logger.debug(`GraphQL: location read after reconnection failed: ${err.message}`);
        }
      }
    }
  }

  sleep(ms) {
    return new Promise((resolve) => {
      this.timer = this.timers.setTimeout(() => {
        this.timer = undefined;
        resolve();
      }, ms);
      this.wake = resolve;
    });
  }

  armWatchdog() {
    this.clearWatchdog();
    this.watchdog = this.timers.setTimeout(() => {
      this.logger.info('GraphQL stream silent for too long, reconnecting');
      this.controller?.abort();
    }, TIMINGS.sseKeepalive);
  }

  clearWatchdog() {
    if (this.watchdog) {
      this.timers.clearTimeout(this.watchdog);
      this.watchdog = undefined;
    }
  }

  /** One stream, until it ends. Resolves true when data flowed. */
  async once() {
    this.controller = new AbortController();
    this.runs += 1;
    let answer = await this.client.graphqlStream(this.query, this.variables, {
      withQuery: this.withQuery,
      signal: this.controller.signal,
    });
    if (answer.status === 401) {
      await this.client.refresh();
      answer = await this.client.graphqlStream(this.query, this.variables, {
        withQuery: this.withQuery,
        signal: this.controller.signal,
      });
    }
    if (answer.status < 200 || answer.status >= 300) {
      throw new Error(`HTTP ${answer.status}`);
    }
    this.open = true;
    this.armWatchdog();
    let buffer = '';
    let flowed = false;
    for await (const chunk of answer.chunks) {
      if (this.stopped) {
        break;
      }
      this.armWatchdog();
      buffer += chunk;
      const { events, rest } = parseSse(buffer);
      buffer = rest;
      for (const { event, data } of events) {
        if (event === 'complete') {
          return flowed;
        }
        let payload;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        if (notFound(payload)) {
          this.withQuery = true;
          this.retryWithQuery = true;
          this.controller.abort();
          return flowed;
        }
        if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
          this.logger.warn(`GraphQL: ${payload.errors.map((e) => e?.message).join(', ')}`);
          continue;
        }
        if (payload?.data) {
          flowed = true;
          await this.onData(payload.data);
        }
      }
    }
    return flowed;
  }

  async stop() {
    this.stopped = true;
    this.clearWatchdog();
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
      this.wake?.();
    }
    this.controller?.abort();
    await this.running?.catch(() => {});
    this.open = false;
  }
}
