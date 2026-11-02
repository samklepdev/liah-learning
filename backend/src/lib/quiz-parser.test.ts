import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slugify, splitSections, parseCoverList } from './quiz-parser.ts';

const fixture = readFileSync(
  new URL('../test/fixtures/chassis.txt', import.meta.url),
  'utf8',
);

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

test('splitSections divides quiz bodies from the answer key', () => {
  const { body, key } = splitSections(fixture);
  assert.ok(body.length > 900, `body had ${body.length} lines`);
  assert.ok(key.length > 300, `key had ${key.length} lines`);
  assert.ok(!body.some((l) => /- Answer Key\s*$/.test(l)));
});

test('parseCoverList finds all 11 courses with their declared counts', () => {
  const { body } = splitSections(fixture);
  const cover = parseCoverList(body);

  assert.equal(cover.length, 11);
  assert.deepEqual(cover[0], {
    position: 1,
    title: 'Tire and Rim Essentials',
    moduleCount: 4,
    questionCount: 10,
  });
  assert.equal(cover[10]?.title, 'Park Brake Technology');
  assert.ok(cover.every((c) => c.questionCount === 10));
});

test('parseCoverList throws when no courses are present', () => {
  assert.throws(() => parseCoverList(['nothing here']), { name: 'QuizParseError' });
});
