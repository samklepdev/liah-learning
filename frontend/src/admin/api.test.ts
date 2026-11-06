import { describe, expect, test, vi, beforeEach } from 'vitest';
import { adminApi } from './api';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('adminApi', () => {
  test('listUsers GETs /api/v1/admin/users with the requested page', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ items: [], total: 0, page: 2, pageSize: 20 }),
    });

    await adminApi.listUsers(2);

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/admin/users?page=2',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  test('setRole PATCHes the role endpoint with the new role', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ user: { id: 'u1', email: 'a@b.com', role: 'admin', createdAt: '' } }),
    });

    await adminApi.setRole('u1', 'admin');

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/admin/users/u1/role',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ role: 'admin' }),
      }),
    );
  });

  test('parseImport posts multipart form data without a JSON content-type header', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ subject: {}, summary: { courses: 1, questions: 10 } }),
    });

    const file = new File(['pdf-bytes'], 'chassis.pdf', { type: 'application/pdf' });
    await adminApi.parseImport(file, 'Chassis');

    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('/api/v1/admin/import/parse');
    expect(call[1].body).toBeInstanceOf(FormData);
    // No explicit Content-Type: the browser must set the multipart boundary.
    expect(call[1].headers).toBeUndefined();
  });

  test('parseUserImport posts multipart form data to the import/parse endpoint', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ rows: [], errors: [] }),
    });

    const file = new File(['Name,Email\nA,a@example.com'], 'students.csv', { type: 'text/csv' });
    await adminApi.parseUserImport(file);

    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('/api/v1/admin/users/import/parse');
    expect(call[1].body).toBeInstanceOf(FormData);
    expect(call[1].headers).toBeUndefined();
  });

  test('confirmUserImport posts the rows to the import/confirm endpoint', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ created: [], skipped: [] }),
    });

    const rows = [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'user' as const }];
    await adminApi.confirmUserImport(rows);

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/admin/users/import/confirm',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ rows }) }),
    );
  });
});
