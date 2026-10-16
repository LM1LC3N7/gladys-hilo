// -----------------------------------------------------------------------------
// The only HTTP access of the integration (the hubs aside, see src/hubs.js):
// Node's fetch with a timeout. Injected everywhere, so the tests never touch
// the network.
//
// request() resolves { status, headers, text, json } for every HTTP answer
// (errors included) and rejects only when no answer came (DNS, TLS, timeout).
// stream() resolves { status, headers, chunks } where chunks is an async
// iterable of text, for the GraphQL subscription (Server-Sent Events).
// -----------------------------------------------------------------------------

import { TIMINGS } from './constants.js';

const parseJson = (text) => {
  if (text === '') {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

function encodeBody({ json, form, headers }) {
  if (form !== undefined) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    return new URLSearchParams(form).toString();
  }
  if (json !== undefined) {
    headers['content-type'] = 'application/json; charset=utf-8';
    return JSON.stringify(json);
  }
  return undefined;
}

export function createTransport({ fetchImpl = globalThis.fetch, userAgent } = {}) {
  const prepare = ({ method = 'GET', url, headers = {}, json, form }) => {
    const sent = { accept: 'application/json', ...headers };
    if (userAgent) {
      sent['user-agent'] = userAgent;
    }
    const body = encodeBody({ json, form, headers: sent });
    return { url, init: { method, headers: sent, body } };
  };

  return {
    async request({ timeout = TIMINGS.requestTimeout, ...options }) {
      const { url, init } = prepare(options);
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeout) });
      const text = await response.text();
      return { status: response.status, headers: response.headers, text, json: parseJson(text) };
    },

    async stream({ signal, ...options }) {
      const { url, init } = prepare({
        ...options,
        headers: { ...options.headers, accept: 'text/event-stream' },
      });
      const response = await fetchImpl(url, { ...init, signal });
      const decoder = new TextDecoder();
      const body = response.body;
      async function* chunks() {
        if (!body) {
          return;
        }
        for await (const chunk of body) {
          yield decoder.decode(chunk, { stream: true });
        }
      }
      return { status: response.status, headers: response.headers, chunks: chunks() };
    },
  };
}
