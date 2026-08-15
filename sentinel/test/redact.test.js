import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDispositions } from '../lib/redact.js';

function decision(overrides) {
  return {
    type: 'person',
    start: 0,
    end: 0,
    confidence: 0.9,
    route: 'auto-redact',
    disposition: null,
    ...overrides,
  };
}

test('placeholder numbering counts per entity type, not globally', () => {
  const text = 'SSN 123-45-6789 belongs to Alice.';
  const ssnStart = text.indexOf('123-45-6789');
  const aliceStart = text.indexOf('Alice');

  const decisions = [
    decision({
      type: 'ssn',
      start: ssnStart,
      end: ssnStart + '123-45-6789'.length,
    }),
    decision({
      type: 'person',
      start: aliceStart,
      end: aliceStart + 'Alice'.length,
    }),
  ];

  const { redactedText } = applyDispositions(text, decisions);
  assert.equal(redactedText, 'SSN [SSN_1] belongs to [PERSON_1].');
});

test('spans with identical text and type share the same token', () => {
  const text = 'Alice met Bob. Later, Alice called Carol.';
  const aliceFirst = text.indexOf('Alice');
  const bob = text.indexOf('Bob');
  const aliceSecond = text.indexOf('Alice', aliceFirst + 1);
  const carol = text.indexOf('Carol');

  const decisions = [
    decision({ start: aliceFirst, end: aliceFirst + 5 }),
    decision({ start: bob, end: bob + 3 }),
    decision({ start: aliceSecond, end: aliceSecond + 5 }),
    decision({ start: carol, end: carol + 5 }),
  ];

  const { redactedText, replacements } = applyDispositions(text, decisions);
  assert.equal(
    redactedText,
    '[PERSON_1] met [PERSON_2]. Later, [PERSON_1] called [PERSON_3].',
  );
  assert.deepEqual(
    replacements.map((r) => r.token),
    ['[PERSON_1]', '[PERSON_2]', '[PERSON_1]', '[PERSON_3]'],
  );
});

test('right-to-left replacement preserves earlier offsets on a multi-span line', () => {
  const text = 'email a@b.com phone 555-1212 name Bob end';
  const email = 'a@b.com';
  const phone = '555-1212';
  const name = 'Bob';
  const emailStart = text.indexOf(email);
  const phoneStart = text.indexOf(phone);
  const nameStart = text.indexOf(name);

  // Deliberately out of offset order in the input array.
  const decisions = [
    decision({
      type: 'phone',
      start: phoneStart,
      end: phoneStart + phone.length,
    }),
    decision({ type: 'person', start: nameStart, end: nameStart + name.length }),
    decision({ type: 'email', start: emailStart, end: emailStart + email.length }),
  ];

  const { redactedText } = applyDispositions(text, decisions);
  assert.equal(
    redactedText,
    'email [EMAIL_1] phone [PHONE_1] name [PERSON_1] end',
  );
});

test('span fully contained in an already-kept span is skipped regardless of confidence', () => {
  const text = 'call 555-123-4567 now';
  const phone = '555-123-4567';
  const phoneStart = text.indexOf(phone);
  const innerStart = text.indexOf('123', phoneStart);

  const decisions = [
    decision({
      type: 'phone',
      start: phoneStart,
      end: phoneStart + phone.length,
      confidence: 0.6,
    }),
    // Fully inside the phone span, higher confidence — must still be skipped.
    decision({
      type: 'digits',
      start: innerStart,
      end: innerStart + 3,
      confidence: 0.99,
    }),
  ];

  const { redactedText, replacements } = applyDispositions(text, decisions);
  assert.equal(redactedText, 'call [PHONE_1] now');
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].type, 'phone');
});

test('partial overlap keeps the higher-confidence span and skips the other', () => {
  const text = 'aaaaaBBBBBccccc';
  const decisions = [
    decision({ type: 'x', start: 0, end: 8, confidence: 0.6 }),
    decision({ type: 'y', start: 5, end: 15, confidence: 0.9 }),
  ];

  const { redactedText, replacements } = applyDispositions(text, decisions);
  assert.equal(redactedText, 'aaaaa[Y_1]');
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].type, 'y');
});

test('consult route with timeout disposition redacts (ADR 0003 fail-closed)', () => {
  const text = 'the user is @rmoyer-dev on record';
  const start = text.indexOf('@rmoyer-dev');
  const decisions = [
    decision({
      type: 'username',
      start,
      end: start + '@rmoyer-dev'.length,
      route: 'consult',
      disposition: 'timeout',
    }),
  ];

  const { redactedText } = applyDispositions(text, decisions);
  assert.equal(redactedText, 'the user is [USERNAME_1] on record');
});

test('consult route with pseudonymize disposition replaces with the same placeholder', () => {
  const text = 'contact is Jordan Lee';
  const start = text.indexOf('Jordan Lee');
  const decisions = [
    decision({
      type: 'person',
      start,
      end: start + 'Jordan Lee'.length,
      route: 'consult',
      disposition: 'pseudonymize',
    }),
  ];

  const { redactedText } = applyDispositions(text, decisions);
  assert.equal(redactedText, 'contact is [PERSON_1]');
});

test('consult route with allow disposition leaves text untouched', () => {
  const text = 'the org is Acme Corp today';
  const start = text.indexOf('Acme Corp');
  const decisions = [
    decision({
      type: 'organization',
      start,
      end: start + 'Acme Corp'.length,
      route: 'consult',
      disposition: 'allow',
    }),
  ];

  const { redactedText, replacements } = applyDispositions(text, decisions);
  assert.equal(redactedText, text);
  assert.deepEqual(replacements, []);
});

test('allow-observed route leaves text untouched, including literal repeats', () => {
  const text = 'zipcode 12345, mailed to zipcode 12345 again';
  const start = text.indexOf('12345');
  const decisions = [
    decision({
      type: 'zip',
      start,
      end: start + '12345'.length,
      route: 'allow-observed',
      disposition: null,
      confidence: 0.1,
    }),
  ];

  const { redactedText, replacements } = applyDispositions(text, decisions);
  assert.equal(redactedText, text);
  assert.deepEqual(replacements, []);
});

test('repeat scrub replaces remaining literal occurrences (>=4 chars) of a redacted span', () => {
  const text = 'SSN 123-45-6789 is on file. Confirm: 123-45-6789.';
  const first = text.indexOf('123-45-6789');
  // Only the first occurrence's offsets are supplied, as Pioneer may return.
  const decisions = [
    decision({
      type: 'ssn',
      start: first,
      end: first + '123-45-6789'.length,
    }),
  ];

  const { redactedText } = applyDispositions(text, decisions);
  assert.equal(
    redactedText,
    'SSN [SSN_1] is on file. Confirm: [SSN_1].',
  );
});

test('repeat scrub does not touch literal occurrences shorter than 4 chars', () => {
  const text = 'code 12 is set, other code 12 too';
  const first = text.indexOf('12');
  const decisions = [
    decision({ type: 'code', start: first, end: first + 2 }),
  ];

  const { redactedText } = applyDispositions(text, decisions);
  assert.equal(redactedText, 'code [CODE_1] is set, other code 12 too');
});

test('repeat scrub does not touch allow-routed spans', () => {
  const text = 'org Acme is fine, Acme again is fine too';
  const start = text.indexOf('Acme');
  const decisions = [
    decision({
      type: 'organization',
      start,
      end: start + 'Acme'.length,
      route: 'consult',
      disposition: 'allow',
    }),
  ];

  const { redactedText } = applyDispositions(text, decisions);
  assert.equal(redactedText, text);
});

test('applyDispositions does not mutate the caller-supplied decision objects', () => {
  const text = 'name is Dana';
  const start = text.indexOf('Dana');
  const original = decision({ start, end: start + 'Dana'.length });
  const decisions = [original];

  applyDispositions(text, decisions);

  assert.deepEqual(original, {
    type: 'person',
    start,
    end: start + 'Dana'.length,
    confidence: 0.9,
    route: 'auto-redact',
    disposition: null,
  });
  assert.equal('token' in original, false);
});

test('token normalization uppercases the type and replaces non-alphanumerics with underscore', () => {
  const text = 'title: senior engineer';
  const start = text.indexOf('senior engineer');
  const decisions = [
    decision({
      type: 'job-title',
      start,
      end: start + 'senior engineer'.length,
      route: 'consult',
      disposition: 'redact',
    }),
  ];

  const { redactedText } = applyDispositions(text, decisions);
  assert.equal(redactedText, 'title: [JOB_TITLE_1]');
});
