// -----------------------------------------------------------------------------
// Hilo challenges ("défis", the peak events of Hydro-Québec seen by Hilo):
// the ChallengeHub messages merged into one book, the phase computed from the
// clock, the scene events derived from two moments (pure functions and a
// plain class, no I/O).
//
// Message shapes and phase rules as python-hilo 2026.10.1 (pyhilo/event.py,
// doc/Challenge(Event) JSON, MIT License, Copyright (c) 2020-2024 David Vallee
// Delisle) and the Home Assistant integration (custom_components/hilo/sensor.py,
// MIT, dvd-dev):
// - phases `preheatStartDateUTC` … `recoveryEndDateUTC` (also `…Utc`);
// - the phase is the one the clock is in, `scheduled` before the pre-heat,
//   `completed` after the recovery;
// - consumption messages carry no id: they belong to the challenge in
//   progress (or the next one);
// - the baseline is `baselineWh`, or the last of `cumulativeBaselinePoints`.
// -----------------------------------------------------------------------------

import { LIMITS, PHASES, RATE_PLANS } from './constants.js';

const HOUR = 60 * 60 * 1000;

const PHASE_KEYS = {
  preheatStart: /^preheatStart(DateUTC|Utc|DateUtc)$/i,
  preheatEnd: /^preheatEnd(DateUTC|Utc|DateUtc)$/i,
  reductionStart: /^reductionStart(DateUTC|Utc|DateUtc)$/i,
  reductionEnd: /^reductionEnd(DateUTC|Utc|DateUtc)$/i,
  recoveryStart: /^recoveryStart(DateUTC|Utc|DateUtc)$/i,
  recoveryEnd: /^recoveryEnd(DateUTC|Utc|DateUtc)$/i,
};

const time = (value) => {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

const finite = (value) => {
  if (value === null || value === undefined || value === '' || value === 'None') {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const bool = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'True' || value === 'true') {
    return true;
  }
  if (value === 'False' || value === 'false') {
    return false;
  }
  return undefined;
};

const text = (value) =>
  typeof value === 'string' && value !== '' && value !== 'None' ? value : undefined;

/** The phase times of a message (ms since the epoch), only those present. */
export function parsePhases(phases) {
  const out = {};
  if (!phases || typeof phases !== 'object') {
    return out;
  }
  for (const [key, value] of Object.entries(phases)) {
    for (const [name, pattern] of Object.entries(PHASE_KEYS)) {
      if (pattern.test(key)) {
        const ms = time(value);
        if (ms !== null) {
          out[name] = ms;
        }
      }
    }
  }
  return out;
}

/** The consumption figures of a message (Wh, $), only those present. */
export function parseConsumption(raw) {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const out = {};
  const points = Array.isArray(raw.cumulativeBaselinePoints) ? raw.cumulativeBaselinePoints : [];
  const baseline = finite(raw.baselineWh) ?? finite(points.at(-1)?.wh);
  if (baseline !== undefined && baseline > 0) {
    out.baselineWh = baseline;
  }
  const current = finite(raw.currentWh);
  if (current !== undefined) {
    out.currentWh = current;
  }
  const reward = finite(raw.reward) ?? finite(raw.estimatedReward);
  if (reward !== undefined) {
    out.reward = reward;
  }
  const savings = finite(raw.energySavingsWh);
  if (savings !== undefined) {
    out.savingsWh = savings;
  }
  const baselineCost = finite(raw.baselineCost);
  if (baselineCost !== undefined) {
    out.baselineCost = baselineCost;
  }
  return out;
}

const ratePlanOf = (raw) => {
  const plan = text(raw?.ratePlan);
  if (!plan) {
    return undefined;
  }
  return plan.toLowerCase().startsWith('flex') ? RATE_PLANS.flex : RATE_PLANS.ch;
};

/** Everything a message says about one challenge, ready to merge. */
export function parseChallenge(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const id = finite(raw.id);
  const patch = {
    phases: parsePhases(raw.phases),
    consumption: { ...parseConsumption(raw.consumption), ...parseConsumption(raw) },
  };
  if (id !== undefined) {
    patch.id = id;
  }
  const progress = text(raw.progress);
  if (progress) {
    patch.progress = progress;
  }
  const period = text(raw.period);
  if (period) {
    patch.period = period.toLowerCase();
  }
  const ratePlan = ratePlanOf(raw);
  if (ratePlan) {
    patch.ratePlan = ratePlan;
  }
  const participating = bool(raw.isParticipating);
  if (participating !== undefined) {
    patch.participating = participating;
  }
  const preseason = bool(raw.isPreSeason) ?? bool(raw.isPreseasonEvent);
  if (preseason !== undefined) {
    patch.preseason = preseason;
  }
  const report = raw.report && typeof raw.report === 'object' ? raw.report : null;
  if (report) {
    patch.report = { status: text(report.status) ?? null };
    const reward = finite(report.reward);
    if (reward !== undefined) {
      patch.report.reward = reward;
    }
  }
  const mode = text(raw.parameters?.mode);
  if (mode) {
    patch.mode = mode;
  }
  return patch;
}

/** The phase a challenge is in at `now`, as python-hilo Event.state. */
export function phaseAt(challenge, now, anticipation = 0) {
  const p = challenge?.phases ?? {};
  if (!Number.isFinite(p.preheatStart) || !Number.isFinite(p.recoveryEnd)) {
    return 'unknown';
  }
  if (now >= p.recoveryEnd) {
    return 'completed';
  }
  if (Number.isFinite(p.recoveryStart) && now >= p.recoveryStart) {
    return 'recovery';
  }
  if (Number.isFinite(p.reductionStart) && now >= p.reductionStart) {
    return 'reduction';
  }
  if (now >= p.preheatStart) {
    return 'preheat';
  }
  if (anticipation > 0 && now >= p.preheatStart - anticipation) {
    return 'anticipation';
  }
  return 'scheduled';
}

/** The next moment the phase of a challenge changes after `now` (null if none). */
export function nextChange(challenge, now, anticipation = 0) {
  const p = challenge?.phases ?? {};
  const moments = [
    anticipation > 0 ? p.preheatStart - anticipation : null,
    p.preheatStart,
    p.reductionStart,
    p.recoveryStart,
    p.recoveryEnd,
  ].filter((t) => Number.isFinite(t) && t > now);
  return moments.length > 0 ? Math.min(...moments) : null;
}

const merge = (current, patch) => ({
  ...current,
  ...patch,
  phases: { ...current?.phases, ...patch.phases },
  consumption: { ...current?.consumption, ...patch.consumption },
  report: patch.report ? { ...current?.report, ...patch.report } : current?.report,
});

/**
 * The challenges of the location: what the hubs told, merged by id. A list
 * message is the truth for the challenges still to come (one missing from it
 * was cancelled); ended challenges stay a while for their result.
 */
export class ChallengeBook {
  constructor() {
    /** id -> challenge */
    this.challenges = new Map();
  }

  get size() {
    return this.challenges.size;
  }

  get(id) {
    return this.challenges.get(id);
  }

  all() {
    return [...this.challenges.values()];
  }

  upsert(patch, now) {
    if (!patch || patch.id === undefined) {
      return null;
    }
    const merged = merge(this.challenges.get(patch.id) ?? { id: patch.id }, patch);
    merged.updatedAt = now;
    this.challenges.set(patch.id, merged);
    return merged;
  }

  /** A full list (`…ListInitialValuesReceived`): the upcoming ones it lacks are gone. */
  applyList(items, now) {
    const seen = new Set();
    for (const raw of Array.isArray(items) ? items : []) {
      const challenge = this.upsert(parseChallenge(raw), now);
      if (challenge) {
        seen.add(challenge.id);
      }
    }
    for (const [id, challenge] of this.challenges) {
      const start = challenge.phases?.preheatStart;
      if (!seen.has(id) && Number.isFinite(start) && start > now) {
        this.challenges.delete(id);
      }
    }
  }

  /** `…Added`, `…ListUpdated…`, `…Details…`: merged by id. */
  applyChallenges(items, now) {
    const list = Array.isArray(items) ? items : [items];
    return list.map((raw) => this.upsert(parseChallenge(raw), now)).filter(Boolean);
  }

  /** `…ConsumptionUpdatedValuesReceived`: for the challenge in progress, or the next one. */
  applyConsumption(raw, now) {
    const target = this.current(now) ?? this.lastEnded(now);
    if (!target) {
      return null;
    }
    const consumption = parseConsumption(raw);
    return this.upsert({ id: target.id, phases: {}, consumption }, now);
  }

  /** The challenge in progress, else the next to come (earliest pre-heat). */
  current(now) {
    let next = null;
    for (const challenge of this.challenges.values()) {
      const phase = phaseAt(challenge, now);
      if (['preheat', 'reduction', 'recovery'].includes(phase)) {
        return challenge;
      }
      if (
        phase === 'scheduled' &&
        (!next || challenge.phases.preheatStart < next.phases.preheatStart)
      ) {
        next = challenge;
      }
    }
    return next;
  }

  /** The challenge that ended last. */
  lastEnded(now) {
    let last = null;
    for (const challenge of this.challenges.values()) {
      if (
        phaseAt(challenge, now) === 'completed' &&
        (!last || challenge.phases.recoveryEnd > last.phases.recoveryEnd)
      ) {
        last = challenge;
      }
    }
    return last;
  }

  /** Forgets the challenges ended long ago. */
  prune(now) {
    for (const [id, challenge] of this.challenges) {
      const end = challenge.phases?.recoveryEnd;
      if (Number.isFinite(end) && now - end > LIMITS.endedChallengeKeep) {
        this.challenges.delete(id);
      }
    }
  }

  /** The next moment any challenge changes phase (to arm the clock). */
  nextChange(now, anticipation = 0) {
    const moments = this.all()
      .map((challenge) => nextChange(challenge, now, anticipation))
      .filter((t) => t !== null);
    return moments.length > 0 ? Math.min(...moments) : null;
  }
}

/** Kilowatt-hours, rounded to the watt-hour. */
export const kwh = (wh) => (Number.isFinite(wh) ? Math.round(wh) / 1000 : undefined);

/** The reward of a challenge: the report's, else the consumption one. */
export const rewardOf = (challenge) => challenge?.report?.reward ?? challenge?.consumption?.reward;

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/**
 * The scene events between what was already told (`memory`: id ->
 * { announced, phase, ended }) and the book at `now`. Returns the events and
 * the new memory. Phases only move forward: a restart in the middle of a
 * phase fires nothing again, and a phase missed while stopped is fired once
 * when still running.
 */
export function challengeEvents(book, memory, now, { anticipation = 0, format = iso } = {}) {
  const events = [];
  const next = { ...memory };
  const order = ['scheduled', ...PHASES, 'completed'];
  for (const challenge of book.all()) {
    const phase = phaseAt(challenge, now, anticipation);
    if (phase === 'unknown') {
      continue;
    }
    const id = String(challenge.id);
    const known = next[id] ?? {};
    const told = { ...known };
    const p = challenge.phases;
    const common = {
      challenge_id: challenge.id,
      rate_plan: challenge.ratePlan ?? null,
      period: challenge.period ?? null,
      preheat_start: iso(p.preheatStart),
      reduction_start: iso(p.reductionStart),
      reduction_end: iso(p.reductionEnd),
      recovery_end: iso(p.recoveryEnd),
      reduction_start_local: format(p.reductionStart),
      reduction_end_local: format(p.reductionEnd),
    };
    if (!known.announced && phase !== 'completed') {
      told.announced = true;
      events.push({
        key: 'announced',
        data: { ...common, participating: challenge.participating ?? null },
      });
    }
    const rank = order.indexOf(phase);
    const toldRank = known.phase ? order.indexOf(known.phase) : -1;
    if (PHASES.includes(phase) && rank > toldRank) {
      told.phase = phase;
      const ends = {
        anticipation: p.preheatStart,
        preheat: p.preheatEnd ?? p.reductionStart,
        reduction: p.reductionEnd,
        recovery: p.recoveryEnd,
      };
      events.push({
        key: 'phase',
        data: {
          ...common,
          phase,
          phase_end: iso(ends[phase]),
          phase_end_local: format(ends[phase]),
        },
      });
    }
    if (phase === 'completed' && !known.ended) {
      told.ended = true;
      told.phase = 'completed';
      // A challenge seen only after its end (first start, long stop) is history.
      if (known.announced || known.phase) {
        const c = challenge.consumption ?? {};
        events.push({
          key: 'ended',
          data: {
            ...common,
            status: challenge.report?.status ?? null,
            reward: rewardOf(challenge) ?? null,
            consumption_kwh: kwh(c.currentWh) ?? null,
            baseline_kwh: kwh(c.baselineWh) ?? null,
            savings_kwh: kwh(c.savingsWh) ?? null,
          },
        });
      }
    }
    told.end = p.recoveryEnd;
    next[id] = told;
  }
  // Remember a bounded number of challenges, the most recent ones.
  const ids = Object.keys(next).sort((a, b) => (next[b].end ?? 0) - (next[a].end ?? 0));
  for (const id of ids.slice(LIMITS.rememberedChallenges)) {
    delete next[id];
  }
  return { events, memory: next };
}

/** Hours from the configuration -> milliseconds. */
export const anticipationMs = (hours) => (Number.isFinite(hours) && hours > 0 ? hours * HOUR : 0);
