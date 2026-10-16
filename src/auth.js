// -----------------------------------------------------------------------------
// Sign-in to the Hilo account: OAuth 2 authorization code with PKCE on the
// Azure AD B2C of Hilo, as python-hilo 2026.10.1 (pyhilo/oauth2helper.py, MIT
// License, Copyright (c) 2020-2024 David Vallee Delisle) and the Home
// Assistant integration (custom_components/hilo/oauth2.py, MIT, dvd-dev) do.
//
// Hilo only redirects to the address registered for that client (the Home
// Assistant "my" link), never to Gladys: the user signs in, then copies the
// address of the page shown at the end (it carries `code` and `state`) into
// the "Finish the sign-in" button of the configuration.
//
// Pure helpers: the requests themselves go through the injected transport.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { AUTH, URN_CLAIM } from './constants.js';

const base64url = (buffer) =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The S256 challenge of a verifier (RFC 7636). */
export const challengeOf = (verifier) => base64url(createHash('sha256').update(verifier).digest());

/** A PKCE pair and an anti-mix-up `state`. */
export function createPkce(random = randomBytes) {
  // python-hilo: urlsafe base64 of 40 random bytes, non alphanumerics removed.
  const verifier = base64url(random(40)).replace(/[^a-zA-Z0-9]/g, '');
  const state = base64url(random(16));
  return { verifier, challenge: challengeOf(verifier), state };
}

/** The sign-in page of Hilo for this PKCE pair. */
export function authorizeUrl({ challenge, state }) {
  const query = new URLSearchParams({
    client_id: AUTH.clientId,
    response_type: 'code',
    redirect_uri: AUTH.redirectUri,
    scope: AUTH.scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  return `https://${AUTH.host}${AUTH.authorizePath}?${query.toString()}`;
}

/**
 * The `code` and `state` of the address the user pasted: the whole address,
 * its query part, or the bare code. `{ error }` when Hilo refused the sign-in
 * (`error_description` kept for the message).
 */
export function parseRedirect(input) {
  const raw = String(input ?? '').trim();
  if (raw === '') {
    return { error: 'empty' };
  }
  let params;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      params = new URLSearchParams(url.search || url.hash.replace(/^#/, ''));
    } catch {
      return { error: 'invalid' };
    }
  } else if (raw.includes('=')) {
    params = new URLSearchParams(raw.replace(/^[?#]/, ''));
  } else if (/^[A-Za-z0-9._~-]{20,}$/.test(raw)) {
    return { code: raw, state: undefined };
  } else {
    return { error: 'invalid' };
  }
  if (params.get('error')) {
    return {
      error: 'refused',
      description: (params.get('error_description') ?? params.get('error')).slice(0, 300),
    };
  }
  const code = params.get('code');
  if (!code) {
    return { error: 'invalid' };
  }
  return { code, state: params.get('state') ?? undefined };
}

/** Form body of the code exchange (the fields Home Assistant sends, no scope). */
export const codeGrant = (code, verifier) => ({
  grant_type: 'authorization_code',
  code,
  redirect_uri: AUTH.redirectUri,
  code_verifier: verifier,
  client_id: AUTH.clientId,
});

/** Form body of a refresh (Home Assistant's LocalOAuth2Implementation). */
export const refreshGrant = (refreshToken) => ({
  grant_type: 'refresh_token',
  client_id: AUTH.clientId,
  refresh_token: refreshToken,
});

/** The claims of a JWT, without checking its signature (we only read our own token). */
export function jwtClaims(token) {
  try {
    const part = String(token).split('.')[1];
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

/** The location URN of the token (first of the array claim), as python-hilo. */
export function urnOf(token) {
  const claim = jwtClaims(token)[URN_CLAIM];
  if (Array.isArray(claim) && typeof claim[0] === 'string') {
    return claim[0];
  }
  return typeof claim === 'string' && claim !== '' ? claim : null;
}

/** The e-mail of the account, for the status messages. */
export function emailOf(token) {
  const claims = jwtClaims(token);
  const email = claims.email ?? claims.emails?.[0] ?? claims.preferred_username;
  return typeof email === 'string' ? email : null;
}

/**
 * The session stored after a token answer: access token, its end, the
 * refresh token (B2C rotates it: always keep the new one), the e-mail and URN.
 */
export function sessionFromTokens(answer, now, previous = null) {
  const accessToken = answer?.access_token;
  if (typeof accessToken !== 'string' || accessToken === '') {
    return null;
  }
  const claims = jwtClaims(accessToken);
  const expiresIn = Number(answer.expires_in);
  const expiresAt = Number.isFinite(expiresIn)
    ? now + expiresIn * 1000
    : Number.isFinite(claims.exp)
      ? claims.exp * 1000
      : now + 30 * 60 * 1000;
  const refreshExpiresIn = Number(answer.refresh_token_expires_in);
  return {
    accessToken,
    expiresAt,
    refreshToken:
      typeof answer.refresh_token === 'string' && answer.refresh_token !== ''
        ? answer.refresh_token
        : (previous?.refreshToken ?? null),
    refreshExpiresAt: Number.isFinite(refreshExpiresIn)
      ? now + refreshExpiresIn * 1000
      : (previous?.refreshExpiresAt ?? null),
    email: emailOf(accessToken) ?? previous?.email ?? null,
    urn: urnOf(accessToken) ?? previous?.urn ?? null,
  };
}
