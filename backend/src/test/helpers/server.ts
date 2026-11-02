import type { AddressInfo } from 'node:net';
import { app } from '../../app.ts';

export async function startTestServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Registers a user and returns the session cookie to send on later requests. */
export async function registerTestUser(
  baseUrl: string,
  email: string,
): Promise<{ cookie: string; userId: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test-password-123' }),
  });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('register returned no cookie');
  const body = (await res.json()) as { user: { id: string } };
  return { cookie: setCookie.split(';')[0]!, userId: body.user.id };
}
