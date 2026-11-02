import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  slugify,
  splitSections,
  parseCoverList,
  parseModuleLists,
  parseQuestionBlocks,
} from './quiz-parser.ts';

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

test('parseModuleLists reads each course list at its declared length', () => {
  const { body } = splitSections(fixture);
  const cover = parseCoverList(body);
  const mods = parseModuleLists(body, cover);

  assert.equal(mods.size, 11);
  assert.deepEqual(mods.get(1), [
    'Tire Technology',
    'Tread and Rim Technology',
    'Run Flat Tires',
    'Tire Pressure Monitoring',
  ]);
  for (const c of cover) {
    assert.equal(mods.get(c.position)?.length, c.moduleCount, `course ${c.position}`);
  }
});

test('parseQuestionBlocks finds 110 questions, each with four options', () => {
  const { body } = splitSections(fixture);
  const byCourse = parseQuestionBlocks(body);

  const total = [...byCourse.values()].reduce((n, qs) => n + qs.length, 0);
  assert.equal(total, 110);
  for (const [course, qs] of byCourse) {
    assert.equal(qs.length, 10, `course ${course}`);
    for (const q of qs) {
      assert.equal(q.options.size, 4, `course ${course} q${q.position}`);
      assert.deepEqual([...q.options.keys()].sort(), ['A', 'B', 'C', 'D']);
      assert.ok(q.moduleTag.length > 0, `course ${course} q${q.position} has no tag`);
    }
  }
});

test('parseQuestionBlocks reads a question whose tag is entirely on the next line', () => {
  const { body } = splitSections(fixture);
  const q = parseQuestionBlocks(body).get(4)?.find((x) => x.position === 7);
  assert.equal(q?.moduleTag, 'TORSION BAR INSPECTION PROCEDURES');
  assert.match(q?.prompt ?? '', /^During torsion bar inspection/);
  assert.ok(!q?.prompt.includes('['), 'prompt must not retain the tag');
});

test('parseQuestionBlocks rejoins a tag split across lines', () => {
  const { body } = splitSections(fixture);
  const q = parseQuestionBlocks(body).get(1)?.find((x) => x.position === 4);
  assert.equal(q?.moduleTag, 'TREAD AND RIM TECHNOLOGY');
});

test('parseQuestionBlocks rejoins a prompt that wraps before its tag', () => {
  const { body } = splitSections(fixture);
  // Course 4 "Understanding Suspension Systems" — Electronic Kinetic Dynamic
  // Suspension is its 7th module, per the PDF's own MODULES COVERED list.
  const q = parseQuestionBlocks(body).get(4)?.find((x) => x.position === 10);
  assert.equal(q?.moduleTag, 'ELECTRONIC KINETIC DYNAMIC SUSPENSION');
  assert.match(q?.prompt ?? '', /roll control and off-road articulation by:/);
});
