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
    <div className="auth-page">
      <div className="auth-card">
        <header className="auth-head">
          <span className="auth-mark" aria-hidden="true">
            L
          </span>
          <h1>{mode === 'login' ? 'Sign in to your account' : 'Create your account'}</h1>
        </header>

        <form onSubmit={handleSubmit} className="auth-form">
          {/* The two fields read as one control: a shared outline with the
              shared edge collapsed, so the pair looks joined rather than
              stacked. Labels are visually replaced by placeholders, so each
              input carries an aria-label for screen readers. */}
          <div className="auth-fields">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              aria-label="Email address"
              autoComplete="email"
              required
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              aria-label="Password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              // Only constrain when choosing a password. On sign-in the server is
              // the authority, and a native "lengthen this text" popup would just
              // get in the way of a legitimate attempt.
              minLength={mode === 'register' ? MIN_PASSWORD_LENGTH : undefined}
              required
            />
          </div>

          {mode === 'register' && (
            <p className="auth-hint">At least {MIN_PASSWORD_LENGTH} characters.</p>
          )}

          {error && (
            <p role="alert" className="auth-error">
              {error}
            </p>
          )}

          <button type="submit" className="auth-submit" disabled={submitting} aria-busy={submitting}>
            {submitting ? 'Working…' : mode === 'login' ? 'Sign in' : 'Sign up'}
          </button>
        </form>

        <p className="auth-switch">
          {mode === 'login' ? 'Not a member yet?' : 'Already registered?'}{' '}
          <button
            type="button"
            className="auth-toggle"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
          >
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
