export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // A FormData body (file uploads) must not get a JSON Content-Type — the
  // browser needs to set its own multipart boundary.
  const isFormData = init?.body instanceof FormData;

  const res = await fetch(`/api/v1${path}`, {
    ...init,
    // Same-origin in dev thanks to the Vite proxy, but stated explicitly so the
    // session cookie still travels if the API is ever moved to its own origin.
    credentials: 'include',
    headers: isFormData
      ? init?.headers
      : { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}) as Record<string, unknown>);

  if (!res.ok) {
    const message = typeof body.error === 'string' ? body.error : res.statusText;
    throw new ApiError(message, res.status);
  }

  return body as T;
}
