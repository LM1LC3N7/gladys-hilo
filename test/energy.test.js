import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnergyMeters } from '../src/energy.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

test('the power holds until the next reading and integrates while live', () => {
  const meters = new EnergyMeters();
  meters.power('a', 1000, 0, true);
  assert.equal(meters.value('a'), 0);
  meters.tick(30 * MINUTE, true);
  assert.equal(meters.value('a'), 0.5);
  meters.power('a', 3000, HOUR, true);
  assert.equal(meters.value('a'), 1);
  meters.tick(HOUR + 20 * MINUTE, true);
  assert.equal(meters.value('a'), 2);
});

test('no link, no energy; a pause forgets the power', () => {
  const meters = new EnergyMeters();
  meters.power('a', 2000, 0, true);
  meters.tick(HOUR, false);
  assert.equal(meters.value('a'), 0);
  meters.tick(2 * HOUR, true);
  assert.equal(meters.value('a'), 2);
  meters.pause(3 * HOUR);
  assert.equal(meters.value('a'), 4);
  meters.tick(5 * HOUR, true);
  assert.equal(meters.value('a'), 4);
});

test('a gap longer than the limit adds nothing; negative powers count as zero', () => {
  const meters = new EnergyMeters({}, { maxGap: HOUR });
  meters.power('a', 1000, 0, true);
  meters.tick(2 * HOUR, true);
  assert.equal(meters.value('a'), 0);
  meters.power('b', -50, 0, true);
  meters.tick(HOUR, true);
  assert.equal(meters.value('b'), 0);
});

test('the indexes survive a restart (kWh only)', () => {
  const meters = new EnergyMeters({ a: 12.5, broken: -1, other: 'x' });
  assert.equal(meters.value('a'), 12.5);
  assert.equal(meters.has('broken'), false);
  meters.power('a', 1000, 0, true);
  meters.tick(HOUR, true);
  assert.deepEqual(meters.snapshot(), { a: 13.5 });
  meters.forget('a');
  assert.equal(meters.value('a'), undefined);
});
