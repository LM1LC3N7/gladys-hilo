// -----------------------------------------------------------------------------
// The two SignalR hubs of Hilo (DeviceHub: devices and their values;
// ChallengeHub: the challenges), through the official Microsoft client
// (@microsoft/signalr). The client negotiates on api.hiloenergie.com with our
// access token, follows the redirect to Azure SignalR Service (its URL and
// token come in the negotiate answer, as python-hilo's SignalRManager reads
// them) and opens the WebSocket.
//
// Hub keeps one connection alive for life: reconnects with a backoff (5 s
// doubling to 5 minutes, reset after a successful connection, as the Home
// Assistant integration does) and calls onConnected after every connection,
// where the subscriptions are sent again (the hubs forget them).
// -----------------------------------------------------------------------------

import signalr from '@microsoft/signalr';
import { TIMINGS } from './constants.js';

// The package is CommonJS: its default import is the module object.
const { HubConnectionBuilder, LogLevel } = signalr;

/** SignalR's logs -> ours (its "No client method" warnings are noise: debug). */
export function signalrLogger(logger) {
  return {
    log(level, message) {
      if (level >= LogLevel.Error) {
        logger.warn(`SignalR: ${message}`);
      } else if (level >= LogLevel.Warning && !/No client method/i.test(message)) {
        logger.info(`SignalR: ${message}`);
      } else {
        logger.debug(`SignalR: ${message}`);
      }
    },
  };
}

/** The real connection (the tests inject a fake with the same surface). */
export function createHubConnection({ url, headers, accessTokenFactory, logger }) {
  return new HubConnectionBuilder()
    .withUrl(url, { headers, accessTokenFactory })
    .configureLogging(signalrLogger(logger))
    .build();
}

export class Hub {
  constructor({
    name,
    url,
    headers = {},
    accessTokenFactory,
    targets,
    onMessage,
    onConnected = async () => {},
    onDisconnected = () => {},
    onFatal = () => {},
    isFatal = () => false,
    createConnection = createHubConnection,
    logger,
    timers = globalThis,
  }) {
    this.name = name;
    this.logger = logger;
    this.timers = timers;
    this.onConnected = onConnected;
    this.onDisconnected = onDisconnected;
    this.onFatal = onFatal;
    this.isFatal = isFatal;
    this.delay = TIMINGS.reconnectBase;
    this.timer = undefined;
    this.stopped = true;
    this.connected = false;
    this.lastError = null;
    this.connection = createConnection({ url, headers, accessTokenFactory, logger });
    for (const target of targets) {
      this.connection.on(target, (...args) => {
        try {
          onMessage(target, args);
        } catch (err) {
          this.logger.warn(`${this.name}: ${target} not handled: ${err.message}`);
        }
      });
    }
    this.connection.onclose((err) => {
      this.connected = false;
      if (this.stopped) {
        return;
      }
      this.lastError = err?.message ?? 'closed';
      this.logger.warn(`${this.name}: connection closed (${this.lastError})`);
      this.onDisconnected(this.lastError);
      this.schedule();
    });
  }

  start() {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.delay = TIMINGS.reconnectBase;
    this.connect();
  }

  schedule() {
    if (this.stopped || this.timer) {
      return;
    }
    const delay = this.delay;
    this.delay = Math.min(this.delay * 2, TIMINGS.reconnectMax);
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      this.connect();
    }, delay);
  }

  async connect() {
    if (this.stopped) {
      return;
    }
    try {
      await this.connection.start();
    } catch (err) {
      this.connected = false;
      this.lastError = err?.message ?? String(err);
      if (this.isFatal(err)) {
        this.logger.warn(`${this.name}: ${this.lastError}`);
        this.onFatal(err);
        return;
      }
      this.logger.warn(`${this.name}: connection failed (${this.lastError})`);
      this.onDisconnected(this.lastError);
      this.schedule();
      return;
    }
    if (this.stopped) {
      await this.connection.stop().catch(() => {});
      return;
    }
    this.connected = true;
    this.lastError = null;
    this.delay = TIMINGS.reconnectBase;
    this.logger.info(`${this.name}: connected`);
    try {
      await this.onConnected();
    } catch (err) {
      this.logger.warn(`${this.name}: subscriptions failed (${err.message})`);
    }
  }

  /** Fire-and-forget invocation of a hub method (python-hilo's `send`). */
  async send(method, ...args) {
    if (!this.connected) {
      this.logger.debug(`${this.name}: ${method} skipped, not connected`);
      return false;
    }
    try {
      await this.connection.send(method, ...args);
      return true;
    } catch (err) {
      this.logger.warn(`${this.name}: ${method} failed (${err.message})`);
      return false;
    }
  }

  async stop() {
    this.stopped = true;
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.connected = false;
    await this.connection.stop().catch(() => {});
  }
}
