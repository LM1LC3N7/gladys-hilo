// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container):
// - the Hilo session (access token and its end, refresh token, e-mail, URN):
//   a restart reuses it instead of asking the user to sign in again;
// - the sign-in in progress (PKCE verifier and state, until the address is
//   pasted back);
// - the energy indexes integrated from the power (kWh per feature);
// - the challenges already told (so a restart fires no scene event twice).
// -----------------------------------------------------------------------------

import { readFile, rename, writeFile } from 'node:fs/promises';

export const STATE_FILE = '/data/hilo-state.json';

export function fileStore(path = STATE_FILE) {
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, 'utf8'));
      } catch {
        return null;
      }
    },
    async save(data) {
      const temporary = `${path}.tmp`;
      await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
      await rename(temporary, path);
    },
  };
}

const text = (value) => (typeof value === 'string' && value !== '' ? value : null);
const finite = (value) => (Number.isFinite(value) ? value : null);

/** The persisted state, repaired: unusable parts become empty. */
export function normalizeMemory(raw) {
  const s = raw?.session;
  const session =
    text(s?.refreshToken) || text(s?.accessToken)
      ? {
          accessToken: text(s.accessToken),
          expiresAt: finite(s.expiresAt) ?? 0,
          refreshToken: text(s.refreshToken),
          refreshExpiresAt: finite(s.refreshExpiresAt),
          email: text(s.email),
          urn: text(s.urn),
        }
      : null;
  const p = raw?.pending;
  const pending =
    text(p?.verifier) && text(p?.state) && finite(p?.createdAt) !== null
      ? { verifier: p.verifier, state: p.state, createdAt: p.createdAt }
      : null;
  const energy = {};
  for (const [key, kwh] of Object.entries(raw?.energy ?? {})) {
    if (Number.isFinite(kwh) && kwh >= 0) {
      energy[key] = kwh;
    }
  }
  const challenges = {};
  for (const [id, told] of Object.entries(raw?.challenges ?? {})) {
    if (told && typeof told === 'object') {
      challenges[id] = {
        announced: told.announced === true,
        phase: text(told.phase) ?? undefined,
        ended: told.ended === true,
        end: finite(told.end) ?? undefined,
      };
    }
  }
  return { session, pending, energy, challenges };
}
