import { useState, type SubmitEvent } from 'react';
import { MIN_PASSWORD_LENGTH } from './api';
import { useAuth } from './useAuth';

type Mode = 'login' | 'register';

export function LoginForm() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await (mode === 'login' ? login(email, password) : register(email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="auth-form">
      <h1>{mode === 'login' ? 'Sign in' : 'Create an account'}</h1>

      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </label>

      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          // Only constrain when choosing a password. On sign-in the server is
          // the authority, and a native "lengthen this text" popup would just
          // get in the way of a legitimate attempt.
          minLength={mode === 'register' ? MIN_PASSWORD_LENGTH : undefined}
          required
        />
      </label>

      {error && <p role="alert" className="auth-error">{error}</p>}

      <button type="submit" disabled={submitting}>
        {submitting ? 'Working…' : mode === 'login' ? 'Sign in' : 'Sign up'}
      </button>

      <button
        type="button"
        className="auth-toggle"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setError(null);
        }}
      >
        {mode === 'login' ? 'Need an account? Sign up' : 'Already registered? Sign in'}
      </button>
    </form>
  );
}
