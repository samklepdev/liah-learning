import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectDialect, parseQuizPack, type ParsedSubject } from './quiz-parser.ts';

/**
 * The eight pop-quiz packs are laid out inconsistently — cover pages, quiz
 * headings, module lists, module tags and answer keys each vary. These tests
 * pin one pack per dialect plus the specific extraction hazard each one
 * introduced, so a parser change cannot silently reshape an imported subject.
 */

const load = (slug: string): string =>
  readFileSync(new URL(`../test/fixtures/${slug}.txt`, import.meta.url), 'utf8');

const parse = (slug: string, title: string): ParsedSubject =>
  parseQuizPack(load(slug), { subjectSlug: slug, subjectTitle: title });

const SUBJECTS = [
  { slug: 'chassis', title: 'Chassis', dialect: 'classic', courses: 11, questions: 110 },
  { slug: 'engine', title: 'Engine', dialect: 'classic', courses: 11, questions: 110 },
  { slug: 'diagnostics', title: 'Diagnostics', dialect: 'numbered', courses: 21, questions: 210 },
  { slug: 'drive-train', title: 'Drive Train', dialect: 'table', courses: 7, questions: 70 },
  { slug: 'drivers-assist', title: 'Drivers Assist', dialect: 'table', courses: 6, questions: 60 },
  { slug: 'electrical', title: 'Electrical', dialect: 'table-split-key', courses: 16, questions: 160 },
  { slug: 'hvac', title: 'HVAC', dialect: 'table', courses: 5, questions: 50 },
  { slug: 'servicing', title: 'Servicing', dialect: 'table', courses: 4, questions: 40 },
];

for (const s of SUBJECTS) {
  test(`detectDialect reads ${s.slug} as the ${s.dialect} dialect`, () => {
    assert.equal(detectDialect(load(s.slug)).name, s.dialect);
  });

  test(`parseQuizPack assembles ${s.slug} completely`, () => {
    const subject = parse(s.slug, s.title);
    assert.equal(subject.courses.length, s.courses);

    const total = subject.courses.reduce((n, c) => n + c.questions.length, 0);
    assert.equal(total, s.questions);

    for (const course of subject.courses) {
      assert.equal(course.questions.length, course.questionCount, course.slug);
      assert.equal(
        course.moduleTitles.length,
        new Set(course.moduleTitles).size,
        `${course.slug} has duplicate module titles`,
      );

      for (const q of course.questions) {
        const at = `${course.slug} q${q.position}`;
        assert.deepEqual(q.options.map((o) => o.label), ['A', 'B', 'C', 'D'], at);
        assert.equal(q.options.filter((o) => o.isCorrect).length, 1, at);
        assert.ok(q.prompt.length > 10, `${at} prompt: "${q.prompt}"`);
        assert.ok(q.explanation.length > 10, `${at} explanation: "${q.explanation}"`);
        assert.ok(course.moduleTitles.includes(q.moduleTitle), `${at} module`);
        // The tag is consumed, never left in the rendered text.
        assert.ok(!q.prompt.includes('['), `${at} prompt kept its tag`);
        assert.ok(!q.explanation.includes('['), `${at} explanation kept its tag`);
        for (const o of q.options) {
          assert.ok(o.body.length > 0, `${at} option ${o.label} is empty`);
          assert.ok(
            !/Practice Material|Retake date|Answer Key/i.test(o.body),
            `${at} option ${o.label} absorbed page furniture: "${o.body}"`,
          );
        }
      }
    }
  });
}

test('an inline module list wrapping mid-title keeps the whole title', () => {
  // Engine course 3 ends "48 Volt Electric Turbo" / "Technology" across lines.
  const course = parse('engine', 'Engine').courses[2]!;
  assert.equal(course.title, 'Forced Introduction Fundamentals');
  assert.ok(
    course.moduleTitles.includes('48 Volt Electric Turbo Technology'),
    `got ${JSON.stringify(course.moduleTitles)}`,
  );
});

test('a pipe-separated module list wrapping mid-title keeps the whole title', () => {
  // Servicing course 3 breaks "Engine Oil Basis Additives" / "and Compositions".
  const course = parse('servicing', 'Servicing').courses[2]!;
  assert.equal(course.moduleTitles.length, 5);
  assert.ok(
    course.moduleTitles.includes('Engine Oil Basis Additives and Compositions'),
    `got ${JSON.stringify(course.moduleTitles)}`,
  );
});

test('a letter-spaced group heading resolves to its module title', () => {
  // Drive Train tags questions with headings set as "M A N U A L T R A N S...".
  const course = parse('drive-train', 'Drive Train').courses[1]!;
  assert.equal(course.title, 'Manual Transmission Explained');
  assert.equal(course.questions[0]?.moduleTitle, 'Manual Transmission Operation');
});

test('an upper-case group heading tags the questions beneath it', () => {
  const course = parse('hvac', 'HVAC').courses[0]!;
  assert.equal(course.questions[0]?.moduleTitle, 'Introducing Air Conditioning');
});

test('a "Module:" line tags the question above it', () => {
  const course = parse('diagnostics', 'Diagnostics').courses[0]!;
  assert.equal(course.title, 'Mastering Onboard Diagnostics');
  assert.equal(course.questions[0]?.moduleTitle, 'Strategy Based Diagnostics');
});

test('a Q/Answer/Why answer-key table yields letters and explanations', () => {
  const q = parse('diagnostics', 'Diagnostics').courses[0]!.questions[0]!;
  assert.equal(q.options.find((o) => o.isCorrect)?.label, 'A');
  assert.match(q.explanation, /code sets when a test fails/i);
  // The key's own "Module:" line must not land in the explanation.
  assert.ok(!/Module:/.test(q.explanation), q.explanation);
});

test('a key whose explanation sits below the entry line reads the line below', () => {
  // Electrical's entry line restates the correct option instead.
  const q = parse('electrical', 'Electrical').courses[0]!.questions[0]!;
  assert.equal(q.options.find((o) => o.isCorrect)?.label, 'B');
  assert.match(q.explanation, /Conventional flow is described as positive to negative/i);
});

test('the last question of a section does not absorb the prose after it', () => {
  // Nothing follows this question but the answer-key preamble.
  const course = parse('chassis', 'Chassis').courses[10]!;
  const q = course.questions.find((x) => x.position === 10)!;
  for (const o of q.options) {
    assert.ok(o.body.length < 200, `option ${o.label} ran on: "${o.body}"`);
    assert.ok(!/section|print/i.test(o.body), `option ${o.label}: "${o.body}"`);
  }
});

test('a wrapped "- Questions 6-10" banner leaves no stray number in an option', () => {
  // The banner wraps so that a bare "10" sits on its own line mid-quiz.
  const course = parse('chassis', 'Chassis').courses[2]!;
  const q = course.questions.find((x) => x.position === 5)!;
  assert.equal(q.options.find((o) => o.label === 'D')?.body, 'Replace the spring');
});

test('a wrapped option keeps the text that continues on the next line', () => {
  const course = parse('chassis', 'Chassis').courses[4]!;
  assert.equal(course.slug, 'chassis-advanced-suspension-technology');
  const q = course.questions.find((x) => x.position === 7)!;
  assert.match(
    q.options.find((o) => o.label === 'B')?.body ?? '',
    /in response to module commands$/,
  );
});

test('course slugs are unique across every pack', () => {
  const slugs = SUBJECTS.flatMap((s) => parse(s.slug, s.title).courses.map((c) => c.slug));
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(slugs.length, 81);
});
