import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBaseUsername } from './username.ts';

test('builds first-initial + last-name, lowercased', () => {
  assert.equal(buildBaseUsername('Jane', 'Doe'), 'jdoe');
});

test('strips punctuation and spaces', () => {
  assert.equal(buildBaseUsername('John', "O'Brien"), 'jobrien');
});

test('strips spaces in multi-word last names', () => {
  assert.equal(buildBaseUsername('Jane', 'Van Der Berg'), 'jvanderberg');
});

test('falls back to "user" when stripping leaves nothing', () => {
  assert.equal(buildBaseUsername('...', '!!!'), 'user');
});

test('only uses the first character of the first name', () => {
  assert.equal(buildBaseUsername('Jonathan', 'Smith'), 'jsmith');
});
