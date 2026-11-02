import { useState } from 'react';
import { useAuth } from './useAuth';

type Mode = 'login' | 'register';

export function LoginForm() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
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
          minLength={12}
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
