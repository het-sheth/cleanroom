import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, route } from '../lib/policy.js';

test('DEFAULT_POLICY has the exact frozen shape', () => {
  assert.deepEqual(DEFAULT_POLICY, {
    version: 1,
    ceilings: { default: 0.75 },
    floor: 0.35,
    contextual_types: ['username', 'organization', 'location', 'job_title'],
    schema_descriptions: {},
  });
});

test('confidence below floor routes to allow-observed', () => {
  assert.equal(route('email', 0.1, DEFAULT_POLICY), 'allow-observed');
});

test('confidence exactly at floor (0.35) does not route to allow-observed', () => {
  const result = route('email', 0.35, DEFAULT_POLICY);
  assert.equal(result, 'consult');
});

test('contextual type routes to consult regardless of confidence', () => {
  assert.equal(route('username', 0.9, DEFAULT_POLICY), 'consult');
});

test('contextual type below floor still routes to allow-observed (floor checked first)', () => {
  assert.equal(route('username', 0.2, DEFAULT_POLICY), 'allow-observed');
});

test('confidence exactly at default ceiling (0.75) routes to auto-redact', () => {
  assert.equal(route('email', 0.75, DEFAULT_POLICY), 'auto-redact');
});

test('confidence above default ceiling routes to auto-redact', () => {
  assert.equal(route('email', 0.9, DEFAULT_POLICY), 'auto-redact');
});

test('confidence between floor and ceiling routes to consult', () => {
  assert.equal(route('email', 0.5, DEFAULT_POLICY), 'consult');
});

test('per-type ceiling override is used instead of default', () => {
  const policy = {
    ...DEFAULT_POLICY,
    ceilings: { default: 0.75, ssn: 0.5 },
  };
  assert.equal(route('ssn', 0.5, policy), 'auto-redact');
  assert.equal(route('ssn', 0.45, policy), 'consult');
});

test('throws TypeError when confidence is below 0', () => {
  assert.throws(() => route('email', -0.1, DEFAULT_POLICY), TypeError);
});

test('throws TypeError when confidence is above 1', () => {
  assert.throws(() => route('email', 1.1, DEFAULT_POLICY), TypeError);
});

test('throws TypeError when entityType is not a string', () => {
  assert.throws(() => route(123, 0.5, DEFAULT_POLICY), TypeError);
});

test('throws TypeError when confidence is NaN', () => {
  assert.throws(() => route('email', NaN, DEFAULT_POLICY), TypeError);
});
