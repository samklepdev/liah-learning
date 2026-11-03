# Interactive Graded Quiz — Design

**Date:** 2026-11-02
**Status:** Approved
**Source material:** `~/Documents/LIAH-classes/quizzes/*.pdf` (8 subjects, outside the repo)

## Goal

A logged-in user picks a course, answers its ten-question quiz, submits, and gets a
grade with per-question explanations and a list of modules to review. Attempts are
recorded so progress against the 9/10 target is visible across retakes.

This build covers the **Chassis** subject (11 courses, 110 questions). The importer is
written against the shared PDF format so the remaining seven subjects are a command
each, not new code.

## Source format

Every subject PDF follows the same structure, verified against Chassis:

- A cover page listing the courses in the pack
- One quiz per course: 10 questions, four options labelled `A.`–`D.`
- Each question tagged with its module in brackets: `[TIRE TECHNOLOGY]`
- All answer keys grouped at the back, one entry per question:
  `N. <LETTER> - <explanation> [MODULE]`

Two properties make this worth parsing rather than retyping: every answer carries a
written explanation, and every question names the module it came from. Those drive the
results screen.

## Decisions

### Course and quiz are one table

The PDFs have exactly one quiz per course, so `courses` carries the quiz metadata
(`pass_score`, `question_count`); `questions` and `attempts` reference `course_id`
directly. One table and one join fewer than modelling them separately.

Accepted cost: supporting two quizzes on a course (pre-test/post-test) later requires a
migration that adds `quizzes`, moves `pass_score` across, and repoints two foreign keys.
Nothing in the eight PDFs suggests that need.

### Parser output is committed as JSON

Import is two steps with a reviewable artifact in between, rather than parsing straight
into Postgres:

```
PDF → pdftotext -layout → parser → backend/src/data/<subject>.quiz.json   (committed)
                                              ↓
                                      seed script → Postgres
```

Rationale:

1. The parse is the fragile step. As JSON in git it can be read and diffed before it
   reaches the database.
2. When a later subject forces a parser change, re-running earlier subjects surfaces
   regressions as a git diff. Without the file, silent content changes are invisible.
3. Seeding works from the repo alone. The PDFs live in `~/Documents`, so a
   database-only pipeline would make them a hidden prerequisite for every fresh clone,
   teammate, and CI run.

Cost: one extra command, ~60KB per subject in git.

### Fixed question and option order

Questions appear 1–10 and options A–D exactly as printed, so the app matches the paper
pack and "I missed question 3" means the same thing to everyone.

Answers are nonetheless stored by `option_id`, never by letter, so adding shuffling later
needs no schema change.

### Answers persist as they are selected

Each selection is saved immediately. This is what makes reloading mid-quiz safe, and
resumption of an unfinished attempt falls out of it.

### Correct answers never leave the server before submission

`is_correct` and `explanation` are excluded from the pre-submit payload. Grading is
server-side only. A test asserts this rather than trusting the serializer.

## Data model

New tables, alongside the existing `users` and `sessions`:

```
subjects          id, slug, title
courses           id, subject_id, position, slug, title,
                  pass_score (default 9), question_count (default 10)
modules           id, course_id, title
questions         id, course_id, module_id, position, prompt, explanation
question_options  id, question_id, label ('A'–'D'), body, is_correct

attempts          id, user_id, course_id, score,
                  started_at, submitted_at        -- NULL submitted_at = in progress
attempt_answers   id, attempt_id, question_id, option_id, is_correct
                  UNIQUE (attempt_id, question_id)
```

Notes:

- **Course slugs are globally unique**, generated as `<subject>-<course-title>` (e.g.
  `chassis-tire-and-rim-essentials`). Two subjects can both have a "Course 1", so a slug
  scoped only to the course title would collide. This keeps URLs to a single slug segment
  instead of nesting subject and course.
- **Module titles come from the course's `MODULES COVERED` list** (title case, e.g.
  "Tire Technology"), not from the bracketed question tags (upper case, e.g.
  `[TIRE TECHNOLOGY]`). Tags are matched to that list case-insensitively and with
  whitespace collapsed. The displayed name is therefore the title-case form.
- `attempts.score` is written once at submission; it is not recomputed on read.
- `attempt_answers.is_correct` is denormalised at save time so a later edit to the
  content cannot silently rewrite a historical grade.
- A partial unique index enforces at most one unsubmitted attempt per user per course.
- Deleting a user cascades to attempts and their answers.

## API

All quiz routes require a session. Catalog routes are public.

```
GET  /api/subjects                           list subjects
GET  /api/courses?subject=chassis            courses in a subject, with my best score
GET  /api/courses/:slug/quiz           auth  questions + options, no is_correct
POST /api/courses/:slug/attempts       auth  start, or resume the open attempt
PUT  /api/attempts/:id/answers/:qid    auth  save one answer (idempotent)
POST /api/attempts/:id/submit          auth  grade, return score
GET  /api/attempts/:id                 auth  graded breakdown with explanations
GET  /api/courses/:slug/attempts       auth  my attempt history for this course
```

`POST /attempts` returns the existing unsubmitted attempt rather than creating a second
one, which makes "resume" and "start" the same client call.

## Screens

Routes via react-router:

```
/                                  dashboard
/courses                           subject + course list, best score per course
/courses/:slug/quiz                take the quiz
/courses/:slug/results/:attemptId  graded result
```

**Taking a quiz** — one question per screen, with a progress bar, free Back/Next
navigation, and a review grid before submission that flags unanswered questions. Nothing
is revealed until submit.

**Results** — score against the 9/10 target and the previous best, then a "modules to
review" summary, then all ten questions: missed ones expanded with the chosen answer, the
correct answer, the explanation and the module; correct ones collapsed to one line.

## Components

```
backend/src/
  models/      subject.model.ts  course.model.ts  quiz.model.ts  attempt.model.ts
  controllers/ catalog.controller.ts  quiz.controller.ts
  routes/      catalog.routes.ts  quiz.routes.ts
  lib/         quiz-parser.ts          pure: extracted text → structured quiz data
  scripts/     parse-quiz-pdf.ts  seed-quizzes.ts
  data/        chassis.quiz.json

frontend/src/
  router.tsx
  pages/       CoursesPage  QuizPage  ResultsPage
  quiz/        api.ts  useQuizAttempt.ts  QuestionCard  ReviewGrid  ResultsBreakdown
```

`quiz-parser.ts` takes text and returns data — no file or database access — so it is
testable against a fixture. `useQuizAttempt` owns answer state, autosave and navigation,
keeping `QuizPage` presentational.

## Parser contract

Input: the output of `pdftotext -layout` on a subject PDF.
Output: one subject with its courses, modules, questions, options and explanations.

`question_count` and the module count come from the cover page listing
(`Course 1 - Tire and Rim Essentials (4 modules, 10 questions)`), not from a hardcoded 10,
so a pack with a different length parses correctly and still gets checked.

Text in the extracted output **wraps mid-element**: both question prompts and module tags
can break across lines, e.g. `[TREAD AND RIM\nTECHNOLOGY]`. The parser joins continuation
lines before matching, and treats a bracketed tag as closed only at `]`.

The parser asserts and **fails loudly** rather than emitting partial data:

- every course in the cover list produces a quiz
- every quiz has exactly the question count the cover page declared
- every question has exactly four options, labelled A–D
- every question matches exactly one answer-key entry
- every answer-key letter resolves to one of that question's options
- every question carries a module tag resolving to one of that course's listed modules

A failure names the course, question number and offending line.

## Error handling

| Case | Behaviour |
|---|---|
| Reload mid-quiz | Refetch the open attempt, restore saved answers |
| Submit twice / double-click | Idempotent — returns the existing result, does not regrade |
| Attempt id belonging to another user | 404, not 403 — do not confirm it exists |
| Submit with blanks | Allowed; blanks count as wrong; review grid warns first |
| Answer saved to a submitted attempt | 409 |
| Re-running the seed | Upsert by stable slug; no duplicates |
| Unknown course slug | 404 |

## Testing

- **Parser unit tests** against a committed fixture of extracted text — the highest-value
  tests, since extraction is the fragile step. Include a malformed fixture asserting the
  parser rejects it.
- **Seed idempotency** — seeding twice leaves the same row counts.
- **Attempt lifecycle integration test** — start, answer, submit, score; verify the score
  against a known answer set.
- **Leak test** — assert `is_correct` and `explanation` appear nowhere in the
  `GET /courses/:slug/quiz` payload.
- **Auth gating** — every quiz route returns 401 without a session.
- **Cross-user isolation** — user B cannot read or submit user A's attempt.

## Out of scope

Learning module content, authoring or editing quizzes in-app, timed quizzes, certificates,
instructor or admin views, per-subject analytics dashboards, and importing the other seven
subjects (unblocked by this work — a command each).
