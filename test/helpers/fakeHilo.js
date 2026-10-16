// -----------------------------------------------------------------------------
// A fake Hilo for the tests, behind the injected transport and hub factory:
// the token endpoint, the REST API, the GraphQL digital twin (persisted
// queries, the SSE stream) and the two SignalR hubs. Nothing touches the
// network.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import * as F from '../fixtures/hilo.js';
import { HiloApp } from '../../src/app.js';
import { registerHandlers } from '../../src/handlers.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
export { silent };

const answer = (status, json) => ({
  status,
  headers: new Map(),
  text: json === undefined ? '' : JSON.stringify(json),
  json,
});

/** A push-driven async iterable of text chunks (an SSE body). */
export function chunkQueue() {
  const queue = [];
  let waiting = null;
  let ended = false;
  return {
    push(text) {
      if (waiting) {
        waiting({ value: text, done: false });
        waiting = null;
      } else {
        queue.push(text);
      }
    },
    end() {
      ended = true;
      if (waiting) {
        waiting({ value: undefined, done: true });
        waiting = null;
      }
    },
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false });
          }
          if (ended) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve) => {
            waiting = resolve;
          });
        },
      };
    },
  };
}

export function fakeHiloServer() {
  const server = {
    requests: [],
    tokenCount: 0,
    refuseRefresh: false,
    refuseCode: false,
    apqKnown: false,
    locations: F.locations,
    streams: [],
    streamStatus: 200,
    failLocations: 0,
    attributes: [],
  };

  server.transport = {
    async request({ method = 'GET', url, headers = {}, json, form: sentForm }) {
      const parsed = new URL(url);
      const record = { method, url, host: parsed.host, path: parsed.pathname, headers, json };
      record.form = sentForm ? { ...sentForm } : undefined;
      server.requests.push(record);
      if (parsed.host === 'connexion.hiloenergie.com') {
        const grant = record.form?.grant_type;
        if (grant === 'refresh_token' && server.refuseRefresh) {
          return answer(400, {
            error: 'invalid_grant',
            error_description: 'AADB2C90080: The provided grant has expired.',
          });
        }
        if (grant === 'authorization_code' && server.refuseCode) {
          return answer(400, {
            error: 'invalid_grant',
            error_description: 'AADB2C90088: The provided grant has not been issued.',
          });
        }
        server.tokenCount += 1;
        return answer(200, F.tokens(server.tokenCount));
      }
      if (parsed.host === 'platform.hiloenergie.com') {
        if (!json.query && !server.apqKnown) {
          return answer(200, { errors: [{ message: 'PersistedQueryNotFound' }] });
        }
        server.apqKnown = true;
        return answer(200, { data: F.graphqlLocation });
      }
      if (method === 'GET' && parsed.pathname === '/Automation/v1/api/Locations') {
        if (server.failLocations > 0) {
          server.failLocations -= 1;
          return answer(503, { message: 'Service Unavailable' });
        }
        return answer(200, server.locations);
      }
      if (method === 'PUT' && parsed.pathname.endsWith('/Attributes')) {
        server.attributes.push({ path: parsed.pathname, json });
        return answer(200, undefined);
      }
      if (parsed.pathname.endsWith('/seasonssummary')) {
        return answer(200, F.seasonsSummary);
      }
      if (parsed.pathname.includes('/seasons/')) {
        return answer(200, F.seasonEvents);
      }
      return answer(404, { message: 'Not found' });
    },

    async stream({ method, url, headers, json, signal }) {
      server.requests.push({ method, url, headers, json, stream: true });
      const chunks = chunkQueue();
      signal?.addEventListener('abort', () => chunks.end());
      server.streams.push({ json, chunks, headers });
      return { status: server.streamStatus, headers: new Map(), chunks };
    },
  };

  return server;
}

/** A SignalR HubConnection stand-in: records the sends, lets a test emit messages. */
export function fakeHubFactory() {
  const factory = {
    connections: [],
    failStart: 0,
    startError: null,
  };
  factory.create = ({ url, headers, accessTokenFactory }) => {
    const connection = {
      url,
      headers,
      accessTokenFactory,
      handlers: new Map(),
      closeHandlers: [],
      sent: [],
      started: 0,
      state: 'Disconnected',
      on(target, handler) {
        connection.handlers.set(target, handler);
      },
      onclose(handler) {
        connection.closeHandlers.push(handler);
      },
      async start() {
        connection.started += 1;
        await accessTokenFactory();
        if (factory.startError) {
          throw factory.startError;
        }
        if (factory.failStart > 0) {
          factory.failStart -= 1;
          throw new Error('WebSocket failed to connect');
        }
        connection.state = 'Connected';
      },
      async stop() {
        connection.state = 'Disconnected';
      },
      async send(method, ...args) {
        connection.sent.push({ method, args });
      },
      emit(target, ...args) {
        const handler = connection.handlers.get(target);
        if (!handler) {
          throw new Error(`no handler for ${target}`);
        }
        handler(...args);
      },
      close(error) {
        connection.state = 'Disconnected';
        for (const handler of connection.closeHandlers) {
          handler(error);
        }
      },
    };
    factory.connections.push(connection);
    return connection;
  };
  factory.hub = (name) => factory.connections.filter((c) => c.url.endsWith(name)).at(-1);
  return factory;
}

/** Timers that never fire by themselves: the tests call them. */
export function manualTimers() {
  const timers = {
    timeouts: new Map(),
    intervals: new Map(),
    next: 1,
    setTimeout(callback, delay) {
      const id = timers.next++;
      timers.timeouts.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.timeouts.delete(id);
    },
    setInterval(callback, delay) {
      const id = timers.next++;
      timers.intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) {
      timers.intervals.delete(id);
    },
    /** Runs (and removes) every pending timeout. */
    async runTimeouts() {
      const pending = [...timers.timeouts.entries()];
      timers.timeouts.clear();
      for (const [, { callback }] of pending) {
        await callback();
      }
    },
    delays() {
      return [...timers.timeouts.values()].map((t) => t.delay);
    },
  };
  return timers;
}

export function memoryStore(initial = null) {
  const store = {
    data: initial === null ? null : structuredClone(initial),
    saves: 0,
    async load() {
      return store.data === null ? null : structuredClone(store.data);
    },
    async save(data) {
      store.saves += 1;
      store.data = structuredClone(data);
    },
  };
  return store;
}

/** Lets pending promise callbacks run. */
export const settle = async (rounds = 5) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** A signed-in session, as /data keeps it. */
export const storedSession = (now) => ({
  session: {
    accessToken: F.jwt(),
    expiresAt: now + 3_600_000,
    refreshToken: 'refresh-0',
    refreshExpiresAt: now + 14 * 86_400_000,
    email: F.EMAIL,
    urn: F.URN,
  },
});

/**
 * The app wired to the SDK's fake Gladys, a fake Hilo and manual timers.
 * `clock.now` drives the time.
 */
export async function startApp({
  config = {},
  memory = null,
  now = F.at('2026-01-04T18:00:00Z'),
} = {}) {
  const clock = { now };
  const server = fakeHiloServer();
  const hubs = fakeHubFactory();
  const timers = manualTimers();
  const store = memoryStore(memory);
  const gladys = createFakeGladys({ config });
  const app = new HiloApp({
    gladys,
    logger: silent,
    transport: server.transport,
    store,
    now: () => clock.now,
    timers,
    createConnection: hubs.create,
  });
  registerHandlers(gladys, app, silent);
  await gladys.connect();
  await settle();
  return { gladys, app, server, hubs, timers, store, clock };
}

/** Sends what the publisher holds to the fake Gladys. */
export async function flush(app) {
  await settle();
  await app.publisher.flush();
}

export { F };
