import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Generated at creation time from first/last name; see buildBaseUsername() in lib/username.ts. */
  username: text('username').notNull().unique(),
  /** Required at every creation path; left nullable so the profile edit form can still blank it later. */
  firstName: text('first_name'),
  lastName: text('last_name'),
  passwordHash: text('password_hash').notNull(),
  /** 'user' or 'admin'. Promoted via the admin users page; the first admin is
   *  set directly in the database. */
  role: text('role').$type<'user' | 'admin'>().notNull().default('user'),
  /** Set true when an admin creates the account with the shared initial
   *  password; cleared the first time the user successfully changes it. */
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** Soft-delete flag. false blocks login, kills existing sessions, and hides
   *  the user from every admin listing. See deletedAt. */
  isActive: boolean('is_active').notNull().default(true),
  /** Set together with isActive — non-null exactly when isActive is false. */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const sessions = pgTable(
  'sessions',
  {
    /**
     * SHA-256 of the token held in the cookie — never the token itself, so a
     * leaked database dump can't be replayed as a live session.
     */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;

export const subjects = pgTable('subjects', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
});

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    /** Globally unique: "<subject>-<course-title>". */
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    passScore: integer('pass_score').notNull().default(9),
    questionCount: integer('question_count').notNull().default(10),
    /** Soft-delete flag. false hides the course from the active catalog
     *  (listSubjects/listCoursesBySubject); a learner's own attempt history
     *  is unaffected. See deletedAt. */
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [unique('courses_subject_position_unique').on(t.subjectId, t.position)],
);

export const modules = pgTable(
  'modules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
  },
  (t) => [unique('modules_course_title_unique').on(t.courseId, t.title)],
);

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => modules.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    prompt: text('prompt').notNull(),
    explanation: text('explanation').notNull(),
  },
  (t) => [unique('questions_course_position_unique').on(t.courseId, t.position)],
);

export const questionOptions = pgTable(
  'question_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    body: text('body').notNull(),
    isCorrect: boolean('is_correct').notNull(),
  },
  (t) => [unique('question_options_question_label_unique').on(t.questionId, t.label)],
);

export const attempts = pgTable(
  'attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    /** Written once at submission; never recomputed on read. */
    score: integer('score'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
  },
  (t) => [
    index('attempts_user_course_idx').on(t.userId, t.courseId),
    // At most one unfinished attempt per user per course, so "start" and
    // "resume" can be the same call.
    uniqueIndex('attempts_one_open_per_user_course')
      .on(t.userId, t.courseId)
      .where(sql`${t.submittedAt} is null`),
  ],
);

export const attemptAnswers = pgTable(
  'attempt_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    optionId: uuid('option_id')
      .notNull()
      .references(() => questionOptions.id, { onDelete: 'cascade' }),
    /** Denormalised at save time so later content edits cannot rewrite history. */
    isCorrect: boolean('is_correct').notNull(),
  },
  (t) => [unique('attempt_answers_attempt_question_unique').on(t.attemptId, t.questionId)],
);

export type Subject = typeof subjects.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type Module = typeof modules.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type QuestionOption = typeof questionOptions.$inferSelect;
export type Attempt = typeof attempts.$inferSelect;
export type AttemptAnswer = typeof attemptAnswers.$inferSelect;
