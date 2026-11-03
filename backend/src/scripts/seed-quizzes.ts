import { readFileSync, readdirSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import { courses, modules, questionOptions, questions, subjects } from '../models/schema.ts';
import type { ParsedSubject } from '../lib/quiz-parser.ts';

/**
 * Upserts a parsed subject. Content is replaced per course rather than merged —
 * questions cascade-delete from modules, so re-seeding after a parser fix yields
 * exactly the JSON's contents. Courses are preserved by slug, so attempts that
 * reference them survive.
 */
export async function seedSubject(
  subject: ParsedSubject,
): Promise<{ courses: number; questions: number }> {
  return db.transaction(async (tx) => {
    const [subjectRow] = await tx
      .insert(subjects)
      .values({ slug: subject.slug, title: subject.title })
      .onConflictDoUpdate({ target: subjects.slug, set: { title: subject.title } })
      .returning({ id: subjects.id });

    let questionTotal = 0;

    for (const course of subject.courses) {
      const [courseRow] = await tx
        .insert(courses)
        .values({
          subjectId: subjectRow!.id,
          position: course.position,
          slug: course.slug,
          title: course.title,
          questionCount: course.questionCount,
        })
        .onConflictDoUpdate({
          target: courses.slug,
          set: {
            subjectId: subjectRow!.id,
            position: course.position,
            title: course.title,
            questionCount: course.questionCount,
          },
        })
        .returning({ id: courses.id });

      const courseId = courseRow!.id;

      // Replace content wholesale; questions and options cascade from modules.
      await tx.delete(modules).where(eq(modules.courseId, courseId));

      const moduleRows = await tx
        .insert(modules)
        .values(course.moduleTitles.map((title) => ({ courseId, title })))
        .returning({ id: modules.id, title: modules.title });

      const moduleIdByTitle = new Map(moduleRows.map((m) => [m.title, m.id]));

      for (const q of course.questions) {
        const moduleId = moduleIdByTitle.get(q.moduleTitle);
        if (!moduleId) {
          throw new Error(`${course.slug} q${q.position}: unknown module "${q.moduleTitle}"`);
        }

        const [questionRow] = await tx
          .insert(questions)
          .values({
            courseId,
            moduleId,
            position: q.position,
            prompt: q.prompt,
            explanation: q.explanation,
          })
          .returning({ id: questions.id });

        await tx.insert(questionOptions).values(
          q.options.map((o) => ({
            questionId: questionRow!.id,
            label: o.label,
            body: o.body,
            isCorrect: o.isCorrect,
          })),
        );

        questionTotal += 1;
      }
    }

    return { courses: subject.courses.length, questions: questionTotal };
  });
}

/** CLI entry: seeds every *.quiz.json passed, defaulting to all of them. */
async function main(): Promise<void> {
  const files = process.argv.slice(2);
  const dataDir = new URL('../data/', import.meta.url);
  const paths: Array<string | URL> =
    files.length > 0
      ? files
      : readdirSync(dataDir)
          .filter((f) => f.endsWith('.quiz.json'))
          .sort()
          .map((f) => new URL(f, dataDir));

  for (const path of paths) {
    const parsed: ParsedSubject = JSON.parse(readFileSync(path, 'utf8'));
    const result = await seedSubject(parsed);
    console.log(`Seeded ${parsed.slug}: ${result.courses} courses, ${result.questions} questions`);
  }
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
