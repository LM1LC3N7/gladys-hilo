// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ACCOUNT_FIELD, ACTIONS, PHASES, SCENE_TRIGGERS } from '../src/constants.js';
import { ANTICIPATION, DEFAULTS } from '../src/config.js';
import { registerHandlers } from '../src/handlers.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

const isAtLeast = (version, required) => {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
};

test('every manifest action has a handler, and every handler an action', async () => {
  const registered = [];
  const gladys = createFakeGladys();
  const original = gladys.onAction.bind(gladys);
  gladys.onAction = (key, handler) => {
    registered.push(key);
    return original(key, handler);
  };
  registerHandlers(gladys, {}, undefined);
  assert.deepEqual(keysOf(manifest.actions).sort(), registered.sort());
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.values(ACTIONS).sort());
});

test('the account field is the one the code checks, an account_link (no redirect back)', () => {
  const field = manifest.config_schema.find((f) => f.key === ACCOUNT_FIELD);
  assert.equal(field.type, 'account_link');
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(SCENE_TRIGGERS).sort());
  const phase = manifest.scene_triggers.find((t) => t.key === SCENE_TRIGGERS.PHASE_STARTED);
  assert.deepEqual(
    phase.fields.find((f) => f.key === 'phase').options.map((o) => o.value),
    PHASES,
  );
});

test('scene triggers require Gladys >= 5.1.0, categories >= 4.86.0', () => {
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]));
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
});

test('config_schema defaults and bounds match the code', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULTS[field.key], field.default, `default of ${field.key}`);
    }
  }
  const anticipation = manifest.config_schema.find((f) => f.key === 'anticipation_hours');
  assert.equal(anticipation.min, ANTICIPATION.min);
  assert.equal(anticipation.max, ANTICIPATION.max);
  const plans = manifest.config_schema.find((f) => f.key === 'rate_plan');
  assert.deepEqual(
    plans.options.map((o) => o.value),
    ['auto', 'CH', 'Flex'],
  );
});

test('section fields are purely presentational, texts within 1000 characters', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(section.label?.en);
    assert.ok(!(section.key in DEFAULTS));
    for (const text of Object.values(section.description ?? {})) {
      assert.ok(text.length <= 1000, `section ${section.key}: ${text.length} characters`);
    }
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30, manifest.name);
});

test('the catalog description holds 10 to 100 characters per language', () => {
  assert.ok(manifest.description.en);
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('labels and placeholders are multi-language objects with English and French', () => {
  for (const field of allFields) {
    assert.ok(field.label?.en && field.label?.fr, `field "${field.key}": label`);
    if (field.placeholder !== undefined) {
      assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
      assert.ok(field.placeholder.en);
    }
  }
  for (const trigger of manifest.scene_triggers) {
    assert.ok(trigger.label.en && trigger.label.fr && trigger.description.fr);
    for (const variable of trigger.variables ?? []) {
      assert.ok(variable.label.en && variable.label.fr, `${trigger.key}.${variable.key}`);
    }
  }
});
