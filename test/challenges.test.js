import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChallengeBook,
  anticipationMs,
  challengeEvents,
  nextChange,
  parseChallenge,
  parseConsumption,
  parsePhases,
  phaseAt,
} from '../src/challenges.js';
import * as F from './fixtures/hilo.js';

const { at } = F;

test('phases: both spellings of the keys, the publication ones ignored', () => {
  assert.deepEqual(parsePhases(F.eventAdded.phases), {
    preheatStart: at('2026-01-04T19:00:00Z'),
    preheatEnd: at('2026-01-04T21:00:00Z'),
    reductionStart: at('2026-01-04T21:00:00Z'),
    reductionEnd: at('2026-01-05T01:00:00Z'),
    recoveryStart: at('2026-01-05T01:00:00Z'),
    recoveryEnd: at('2026-01-05T02:00:00Z'),
  });
  assert.deepEqual(parsePhases({ preheatStartUtc: '2026-01-01T00:00:00Z', bad: 'x' }), {
    preheatStart: at('2026-01-01T00:00:00Z'),
  });
  assert.deepEqual(parsePhases(null), {});
});

test('consumption: Wh, baseline from the last cumulative point, reward', () => {
  assert.deepEqual(parseConsumption(F.eventConsumption), {
    baselineWh: 45058.03108215332,
    currentWh: 250,
    reward: 2.26,
    savingsWh: 3990.079,
  });
  assert.deepEqual(
    parseConsumption({ cumulativeBaselinePoints: [{ wh: 0 }, { wh: 1200.5 }], currentWh: 'None' }),
    { baselineWh: 1200.5 },
  );
  assert.deepEqual(parseConsumption(F.flexDetails.consumption), {
    baselineWh: 8848.80006313324,
    baselineCost: 3.98,
  });
});

test('a challenge message: rate plan, period, report, legacy Python strings', () => {
  const completed = parseChallenge(F.eventDetailsCompleted);
  assert.equal(completed.id, 348);
  assert.equal(completed.period, 'pm');
  assert.deepEqual(completed.report, { status: 'Success' });
  assert.equal(completed.consumption.reward, 2.97);
  assert.equal(completed.mode, 'extreme');
  assert.equal(parseChallenge(F.eventAdded).ratePlan, 'CH');
  assert.equal(parseChallenge({ id: 1, ratePlan: 'flex' }).ratePlan, 'Flex');
  const legacy = parseChallenge(F.legacyList[0]);
  assert.equal(legacy.participating, true);
  assert.equal(legacy.id, 274);
  assert.equal(parseChallenge(null), null);
});

test('the phase follows the clock', () => {
  const challenge = parseChallenge(F.eventAdded);
  const cases = [
    ['2026-01-04T10:00:00Z', 'scheduled'],
    ['2026-01-04T19:00:00Z', 'preheat'],
    ['2026-01-04T21:00:00Z', 'reduction'],
    ['2026-01-05T00:59:59Z', 'reduction'],
    ['2026-01-05T01:00:00Z', 'recovery'],
    ['2026-01-05T02:00:00Z', 'completed'],
  ];
  for (const [iso, phase] of cases) {
    assert.equal(phaseAt(challenge, at(iso)), phase, iso);
  }
  const six = anticipationMs(6);
  assert.equal(phaseAt(challenge, at('2026-01-04T13:00:00Z'), six), 'anticipation');
  assert.equal(phaseAt(challenge, at('2026-01-04T12:59:00Z'), six), 'scheduled');
  assert.equal(phaseAt({ phases: {} }, 0), 'unknown');
  assert.equal(nextChange(challenge, at('2026-01-04T10:00:00Z'), six), at('2026-01-04T13:00:00Z'));
  assert.equal(nextChange(challenge, at('2026-01-04T21:30:00Z')), at('2026-01-05T01:00:00Z'));
  assert.equal(nextChange(challenge, at('2026-01-05T03:00:00Z')), null);
});

test('the book: added, details by id, consumption without id to the one in progress', () => {
  const book = new ChallengeBook();
  const now = at('2026-01-04T18:00:00Z');
  book.applyChallenges(F.eventAdded, now);
  assert.equal(book.current(now).id, 354);
  book.applyChallenges([F.eventDetailsUpdated], now);
  assert.equal(book.get(354).progress, 'inProgress');
  assert.equal(book.get(354).phases.reductionStart, at('2026-01-04T21:00:00Z'));
  const during = at('2026-01-04T21:20:00Z');
  book.applyConsumption(F.eventConsumption, during);
  assert.equal(book.get(354).consumption.reward, 2.26);
  assert.equal(book.get(354).consumption.currentWh, 250);
  // A completed one arrives with its report: it is the last ended.
  book.applyChallenges(F.eventDetailsCompleted, during);
  assert.equal(book.lastEnded(during).id, 348);
  assert.equal(book.current(during).id, 354);
  assert.equal(book.nextChange(during), at('2026-01-05T01:00:00Z'));
});

test('the book: a full list drops the upcoming challenges it lacks (cancelled)', () => {
  const book = new ChallengeBook();
  const now = at('2026-01-04T18:00:00Z');
  book.applyChallenges([F.eventAdded, F.flexDetails, F.eventDetailsCompleted], now);
  assert.equal(book.size, 3);
  book.applyList([F.flexDetails], now);
  assert.deepEqual(
    book.all().map((c) => c.id),
    [355, 348],
  );
  // Long after the end, the ended ones go.
  book.prune(at('2026-01-10T00:00:00Z'));
  assert.equal(book.size, 0);
});

test('scene events: announced, every phase once and in order, ended with the result', () => {
  const book = new ChallengeBook();
  let memory = {};
  const fire = (iso, options) => {
    const result = challengeEvents(book, memory, at(iso), options);
    memory = result.memory;
    return result.events.map((e) => [e.key, e.data.phase ?? null]);
  };
  book.applyChallenges(F.eventAdded, at('2026-01-03T12:00:00Z'));
  const options = { anticipation: anticipationMs(2) };
  assert.deepEqual(fire('2026-01-03T12:00:00Z', options), [['announced', null]]);
  assert.deepEqual(fire('2026-01-03T13:00:00Z', options), []);
  assert.deepEqual(fire('2026-01-04T17:00:00Z', options), [['phase', 'anticipation']]);
  assert.deepEqual(fire('2026-01-04T19:00:00Z', options), [['phase', 'preheat']]);
  assert.deepEqual(fire('2026-01-04T19:30:00Z', options), []);
  assert.deepEqual(fire('2026-01-04T21:00:00Z', options), [['phase', 'reduction']]);
  book.applyConsumption(F.eventConsumption, at('2026-01-04T21:20:00Z'));
  assert.deepEqual(fire('2026-01-05T01:00:01Z', options), [['phase', 'recovery']]);
  const ended = challengeEvents(book, memory, at('2026-01-05T02:00:00Z'), options);
  assert.equal(ended.events.length, 1);
  assert.equal(ended.events[0].key, 'ended');
  assert.deepEqual(
    {
      challenge_id: ended.events[0].data.challenge_id,
      reward: ended.events[0].data.reward,
      consumption_kwh: ended.events[0].data.consumption_kwh,
      baseline_kwh: ended.events[0].data.baseline_kwh,
      savings_kwh: ended.events[0].data.savings_kwh,
      reduction_start: ended.events[0].data.reduction_start,
    },
    {
      challenge_id: 354,
      reward: 2.26,
      consumption_kwh: 0.25,
      baseline_kwh: 45.058,
      savings_kwh: 3.99,
      reduction_start: '2026-01-04T21:00:00.000Z',
    },
  );
  memory = ended.memory;
  assert.deepEqual(fire('2026-01-05T03:00:00Z', options), []);
});

test('scene events: a restart in a phase fires nothing again; a missed phase fires once', () => {
  const book = new ChallengeBook();
  book.applyChallenges(F.eventAdded, at('2026-01-04T18:00:00Z'));
  const memory = { 354: { announced: true, phase: 'preheat' } };
  const result = challengeEvents(book, memory, at('2026-01-04T19:30:00Z'));
  assert.deepEqual(result.events, []);
  const later = challengeEvents(book, memory, at('2026-01-04T22:00:00Z'));
  assert.deepEqual(
    later.events.map((e) => [e.key, e.data.phase]),
    [['phase', 'reduction']],
  );
});

test('scene events: a challenge first seen after its end is history (nothing fired)', () => {
  const book = new ChallengeBook();
  book.applyChallenges(F.eventDetailsCompleted, at('2026-01-04T18:00:00Z'));
  const { events, memory } = challengeEvents(book, {}, at('2026-01-04T18:00:00Z'));
  assert.deepEqual(events, []);
  assert.equal(memory[348].ended, true);
});

test('scene events: first seen mid-reduction, announced then the reduction', () => {
  const book = new ChallengeBook();
  book.applyChallenges(F.eventAdded, at('2026-01-04T22:00:00Z'));
  const { events } = challengeEvents(book, {}, at('2026-01-04T22:00:00Z'), {
    format: (ms) => `local:${ms}`,
  });
  assert.deepEqual(
    events.map((e) => [e.key, e.data.phase ?? null]),
    [
      ['announced', null],
      ['phase', 'reduction'],
    ],
  );
  assert.equal(events[1].data.phase_end, '2026-01-05T01:00:00.000Z');
  assert.equal(events[1].data.phase_end_local, `local:${at('2026-01-05T01:00:00Z')}`);
  assert.equal(events[0].data.period, 'pm');
  assert.equal(events[0].data.rate_plan, 'CH');
});
