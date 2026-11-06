import { request, type User } from '../auth/api';

export type AdminUser = User;

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminAttempt = {
  id: string;
  courseTitle: string;
  courseSlug: string;
  subjectSlug: string;
  score: number | null;
  startedAt: string;
  submittedAt: string | null;
  answeredCount: number;
};

/**
 * Opaque from the frontend's point of view — it is parsed on the server and
 * handed back unmodified to /confirm. Typed as unknown rather than mirrored
 * field-for-field so this file does not have to track the backend's
 * ParsedSubject shape.
 */
export type ParsedSubjectPayload = unknown;

export type ImportSummary = { courses: number; questions: number };

export type ImportedUserRow = {
  row: number;
  firstName: string;
  lastName: string;
  role: 'user' | 'admin';
};
export type ImportRowError = { row: number; message: string };
export type ConfirmedUser = {
  username: string;
  firstName: string | null;
  lastName: string | null;
  role: 'user' | 'admin';
  password: string;
};
export type SkippedUser = { firstName: string | null; lastName: string | null; reason: string };

export const adminApi = {
  listUsers: (page: number) => request<Page<AdminUser>>(`/admin/users?page=${page}`),

  setRole: (id: string, role: 'user' | 'admin') =>
    request<{ user: AdminUser }>(`/admin/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  deleteUser: (id: string) => request<void>(`/admin/users/${id}`, { method: 'DELETE' }),

  getUserAttempts: (id: string) =>
    request<{ attempts: AdminAttempt[] }>(`/admin/users/${id}/attempts`),

  parseImport: (file: File, subjectTitle: string) => {
    const form = new FormData();
    form.append('pdf', file);
    form.append('subjectTitle', subjectTitle);
    return request<{ subject: ParsedSubjectPayload; summary: ImportSummary } | { errors: string[] }>(
      '/admin/import/parse',
      { method: 'POST', body: form },
    );
  },

  confirmImport: (subject: ParsedSubjectPayload) =>
    request<ImportSummary>('/admin/import/confirm', {
      method: 'POST',
      body: JSON.stringify({ subject }),
    }),

  parseUserImport: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ rows: ImportedUserRow[]; errors: ImportRowError[] }>(
      '/admin/users/import/parse',
      { method: 'POST', body: form },
    );
  },

  confirmUserImport: (rows: ImportedUserRow[]) =>
    request<{ created: ConfirmedUser[]; skipped: SkippedUser[] }>('/admin/users/import/confirm', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    }),
};
