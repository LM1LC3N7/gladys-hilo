import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  authorizeUrl,
  challengeOf,
  codeGrant,
  createPkce,
  emailOf,
  jwtClaims,
  parseRedirect,
  refreshGrant,
  sessionFromTokens,
  urnOf,
} from '../src/auth.js';
import { AUTH } from '../src/constants.js';
import { EMAIL, URN, jwt, tokens } from './fixtures/hilo.js';

test('PKCE: an alphanumeric verifier of 43+ characters and its S256 challenge', () => {
  const pkce = createPkce();
  assert.match(pkce.verifier, /^[A-Za-z0-9]{43,128}$/);
  const expected = createHash('sha256')
    .update(pkce.verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  assert.equal(pkce.challenge, expected);
  assert.match(pkce.state, /^[A-Za-z0-9_-]{20,}$/);
  assert.notEqual(createPkce().verifier, pkce.verifier);
});

test('PKCE: the RFC 7636 appendix B example', () => {
  assert.equal(
    challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
});

test('authorizeUrl: the Hilo B2C page with the client, scope, PKCE and the HA redirect', () => {
  const url = new URL(authorizeUrl({ challenge: 'abc', state: 'xyz' }));
  assert.equal(url.host, 'connexion.hiloenergie.com');
  assert.equal(
    url.pathname,
    '/HiloDirectoryB2C.onmicrosoft.com/B2C_1A_SIGN_IN/oauth2/v2.0/authorize',
  );
  assert.equal(url.searchParams.get('client_id'), '1ca9f585-4a55-4085-8e30-9746a65fa561');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://my.home-assistant.io/redirect/oauth');
  assert.equal(
    url.searchParams.get('scope'),
    'openid https://HiloDirectoryB2C.onmicrosoft.com/hiloapis/user_impersonation offline_access',
  );
  assert.equal(url.searchParams.get('code_challenge'), 'abc');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'xyz');
});

test('parseRedirect: the whole address, its query, a bare code, errors', () => {
  assert.deepEqual(
    parseRedirect('https://my.home-assistant.io/redirect/oauth?state=s1&code=eyJraWQiOi.abc-def'),
    { code: 'eyJraWQiOi.abc-def', state: 's1' },
  );
  assert.deepEqual(parseRedirect('  ?code=c2&state=s2 '), { code: 'c2', state: 's2' });
  assert.deepEqual(parseRedirect('code=c3'), { code: 'c3', state: undefined });
  assert.deepEqual(parseRedirect('eyJraWQiOiJjcGltY29yZV8wOTI1MjAxNSIsInZlciI6IjEuMCJ9'), {
    code: 'eyJraWQiOiJjcGltY29yZV8wOTI1MjAxNSIsInZlciI6IjEuMCJ9',
    state: undefined,
  });
  assert.deepEqual(parseRedirect(''), { error: 'empty' });
  assert.deepEqual(parseRedirect('https://my.home-assistant.io/redirect/oauth'), {
    error: 'invalid',
  });
  assert.deepEqual(parseRedirect('hello world'), { error: 'invalid' });
  assert.deepEqual(
    parseRedirect(
      'https://my.home-assistant.io/redirect/oauth?error=access_denied&error_description=AADB2C90091%3A+The+user+has+cancelled',
    ),
    { error: 'refused', description: 'AADB2C90091: The user has cancelled' },
  );
});

test('token forms: the fields Home Assistant sends', () => {
  assert.deepEqual(codeGrant('c', 'v'), {
    grant_type: 'authorization_code',
    code: 'c',
    redirect_uri: AUTH.redirectUri,
    code_verifier: 'v',
    client_id: AUTH.clientId,
  });
  assert.deepEqual(refreshGrant('r'), {
    grant_type: 'refresh_token',
    client_id: AUTH.clientId,
    refresh_token: 'r',
  });
});

test('JWT claims: URN (first of the array) and e-mail', () => {
  const token = jwt();
  assert.equal(urnOf(token), URN);
  assert.equal(emailOf(token), EMAIL);
  assert.equal(urnOf(jwt({ 'urn:com:hiloenergie:profile:location_hilo_id': 'urn:x' })), 'urn:x');
  assert.equal(urnOf('not-a-jwt'), null);
  assert.deepEqual(jwtClaims('a.%%%.c'), {});
  assert.equal(
    emailOf(jwt({ email: undefined, emails: ['other@example.com'] })),
    'other@example.com',
  );
});

test('sessionFromTokens: expiry, rotated refresh token, kept when absent', () => {
  const now = 1_000_000;
  const first = sessionFromTokens(tokens(1), now);
  assert.equal(first.expiresAt, now + 3_600_000);
  assert.equal(first.refreshToken, 'refresh-1');
  assert.equal(first.refreshExpiresAt, now + 1_209_600_000);
  assert.equal(first.email, EMAIL);
  assert.equal(first.urn, URN);
  const second = sessionFromTokens({ access_token: jwt(), expires_in: '60' }, now, first);
  assert.equal(second.refreshToken, 'refresh-1');
  assert.equal(second.expiresAt, now + 60_000);
  const fromExp = sessionFromTokens({ access_token: jwt({ exp: 2000 }) }, now);
  assert.equal(fromExp.expiresAt, 2_000_000);
  assert.equal(sessionFromTokens({}, now), null);
});
