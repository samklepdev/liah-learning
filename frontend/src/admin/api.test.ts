import { describe, expect, test, vi, beforeEach } from 'vitest';
import { adminApi } from './api';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('adminApi', () => {
  test('listUsers GETs /api/admin/users', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ users: [] }),
    });

    await adminApi.listUsers();

    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/users',
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
      '/api/admin/users/u1/role',
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
    expect(call[0]).toBe('/api/admin/import/parse');
    expect(call[1].body).toBeInstanceOf(FormData);
    // No explicit Content-Type: the browser must set the multipart boundary.
    expect(call[1].headers).toBeUndefined();
  });
});
