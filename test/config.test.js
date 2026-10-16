import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { normalizeMemory } from '../src/store.js';

test('config: defaults and bounds', () => {
  assert.deepEqual(normalizeConfig(), {
    ratePlan: 'auto',
    anticipationHours: 0,
    challengeLock: false,
    language: 'fr',
  });
  assert.deepEqual(
    normalizeConfig({
      rate_plan: 'Flex',
      anticipation_hours: 99,
      challenge_lock: true,
      language: 'EN',
    }),
    { ratePlan: 'Flex', anticipationHours: 24, challengeLock: true, language: 'en' },
  );
  assert.equal(normalizeConfig({ rate_plan: 'other' }).ratePlan, 'auto');
  assert.equal(normalizeConfig({ anticipation_hours: '' }).anticipationHours, 0);
  assert.equal(normalizeConfig({ anticipation_hours: '2.5' }).anticipationHours, 2.5);
  assert.equal(normalizeConfig({ anticipation_hours: -3 }).anticipationHours, 0);
  assert.equal(normalizeConfig({ language: 'de' }).language, 'fr');
});

test('memory: repaired, unusable parts dropped', () => {
  assert.deepEqual(normalizeMemory(null), {
    session: null,
    pending: null,
    energy: {},
    challenges: {},
  });
  const memory = normalizeMemory({
    session: { refreshToken: 'r', accessToken: '', expiresAt: 'x', email: 'a@b.c' },
    pending: { verifier: 'v', state: 's' },
    energy: { a: 1.5, b: -1, c: 'x' },
    challenges: { 354: { announced: true, phase: 'preheat', end: 5 }, bad: null },
  });
  assert.deepEqual(memory.session, {
    accessToken: null,
    expiresAt: 0,
    refreshToken: 'r',
    refreshExpiresAt: null,
    email: 'a@b.c',
    urn: null,
  });
  assert.equal(memory.pending, null);
  assert.deepEqual(memory.energy, { a: 1.5 });
  assert.deepEqual(memory.challenges, {
    354: { announced: true, phase: 'preheat', ended: false, end: 5 },
  });
  assert.equal(normalizeMemory({ session: { email: 'x' } }).session, null);
});
