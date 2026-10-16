// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { RATE_PLANS } from './constants.js';
import { LANGUAGES } from './i18n.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  rate_plan: RATE_PLANS.auto,
  anticipation_hours: 0,
  challenge_lock: false,
  language: 'fr',
};

export const ANTICIPATION = { min: 0, max: 24 };

const RATE_PLAN_VALUES = Object.values(RATE_PLANS);

export function normalizeConfig(raw = {}) {
  const plan = String(raw?.rate_plan ?? DEFAULTS.rate_plan).trim();
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  const hours = Number(raw?.anticipation_hours);
  return {
    ratePlan: RATE_PLAN_VALUES.includes(plan) ? plan : DEFAULTS.rate_plan,
    anticipationHours:
      raw?.anticipation_hours === '' ||
      raw?.anticipation_hours === null ||
      raw?.anticipation_hours === undefined ||
      !Number.isFinite(hours)
        ? DEFAULTS.anticipation_hours
        : Math.max(ANTICIPATION.min, Math.min(ANTICIPATION.max, hours)),
    challengeLock: raw?.challenge_lock === true || raw?.challenge_lock === 'true',
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}
