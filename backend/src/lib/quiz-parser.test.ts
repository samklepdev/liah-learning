import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from './quiz-parser.ts';

test('slugify lowercases and hyphenates', () => {
  assert.equal(slugify('Tire and Rim Essentials'), 'tire-and-rim-essentials');
});

test('slugify strips punctuation and collapses separators', () => {
  assert.equal(
    slugify('Best Practice Low Profile / Run Flat Tire Strip and Fit'),
    'best-practice-low-profile-run-flat-tire-strip-and-fit',
  );
});

test('slugify trims leading and trailing hyphens', () => {
  assert.equal(slugify('  ABS Operations & Testing  '), 'abs-operations-testing');
});
