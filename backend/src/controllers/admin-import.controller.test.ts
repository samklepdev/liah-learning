import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { setUserRole } from '../models/admin-user.model.ts';

let baseUrl: string;
let close: () => Promise<void>;

before(async () => {
  ({ baseUrl, close } = await startTestServer());
});

after(async () => {
  await close();
  await closeDb();
});

beforeEach(async () => {
  await resetDb();
});

async function adminCookie() {
  const { cookie, userId } = await registerTestUser(baseUrl, 'admin@example.com');
  await setUserRole(userId, 'admin');
  return cookie;
}

function chassisFixtureAsPdfText(): string {
  // The parser's input is pdftotext's *output*, not a PDF. The test fixture
  // is already that plain-text form (see lib/quiz-parser.test.ts), so the
  // controller test posts it as the upload body. The controller treats a
  // .txt upload as pre-extracted text, skipping pdftotext, so this test
  // needs no pdftotext/poppler dependency.
  return readFileSync(new URL('../test/fixtures/chassis.txt', import.meta.url), 'utf8');
}

test('POST /api/v1/admin/import/parse returns a summary for a good pack', async () => {
  const cookie = await adminCookie();
  const form = new FormData();
  form.append(
    'pdf',
    new Blob([chassisFixtureAsPdfText()], { type: 'text/plain' }),
    'chassis.txt',
  );
  form.append('subjectTitle', 'Chassis');

  const res = await fetch(`${baseUrl}/api/v1/admin/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: form,
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { summary: { courses: number; questions: number } };
  assert.equal(body.summary.courses, 11);
  assert.equal(body.summary.questions, 110);
});

test('POST /api/v1/admin/import/parse 422s with errors for a malformed pack', async () => {
  const cookie = await adminCookie();
  const malformed = readFileSync(
    new URL('../test/fixtures/malformed.txt', import.meta.url),
    'utf8',
  );
  const form = new FormData();
  form.append('pdf', new Blob([malformed], { type: 'text/plain' }), 'bad.txt');
  form.append('subjectTitle', 'Bad');

  const res = await fetch(`${baseUrl}/api/v1/admin/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: form,
  });
  assert.equal(res.status, 422);
  const body = (await res.json()) as { errors: string[] };
  assert.equal(body.errors.length, 1);
});

test('POST /api/v1/admin/import/parse 404s for a non-admin', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'plain@example.com');
  const form = new FormData();
  form.append('pdf', new Blob(['x'], { type: 'text/plain' }), 'x.txt');
  form.append('subjectTitle', 'X');

  const res = await fetch(`${baseUrl}/api/v1/admin/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: form,
  });
  assert.equal(res.status, 404);
});

test('POST /api/v1/admin/import/confirm seeds the parsed subject', async () => {
  const cookie = await adminCookie();
  const form = new FormData();
  form.append(
    'pdf',
    new Blob([chassisFixtureAsPdfText()], { type: 'text/plain' }),
    'chassis.txt',
  );
  form.append('subjectTitle', 'Chassis');

  const parseRes = await fetch(`${baseUrl}/api/v1/admin/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: form,
  });
  const { subject } = (await parseRes.json()) as { subject: unknown };

  const confirmRes = await fetch(`${baseUrl}/api/v1/admin/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject }),
  });
  assert.equal(confirmRes.status, 200);
  const body = (await confirmRes.json()) as { courses: number; questions: number };
  assert.equal(body.courses, 11);
  assert.equal(body.questions, 110);
});

test('POST /api/v1/admin/import/confirm is idempotent on re-import', async () => {
  const cookie = await adminCookie();
  const form = new FormData();
  form.append(
    'pdf',
    new Blob([chassisFixtureAsPdfText()], { type: 'text/plain' }),
    'chassis.txt',
  );
  form.append('subjectTitle', 'Chassis');
  const { subject } = (await (
    await fetch(`${baseUrl}/api/v1/admin/import/parse`, {
      method: 'POST',
      headers: { cookie },
      body: form,
    })
  ).json()) as { subject: unknown };

  const confirm = () =>
    fetch(`${baseUrl}/api/v1/admin/import/confirm`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject }),
    });

  await confirm();
  const second = await confirm();
  assert.equal(second.status, 200);

  const list = await fetch(`${baseUrl}/api/v1/subjects`);
  const body = (await list.json()) as { subjects: unknown[] };
  assert.equal(body.subjects.length, 1);
});
