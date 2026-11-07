import { useState, type SubmitEvent } from 'react';
import liahLogo from '../assets/liah-logo.png';
import { authApi, MIN_PASSWORD_LENGTH } from './api';
import { useAuth } from './useAuth';

type Mode = 'login' | 'register' | 'forgot';

export function LoginForm() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await (mode === 'login' ? login(username, password) : register(firstName, lastName, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgotSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await authApi.forgotPassword(username);
    } catch {
      // Intentionally ignored: the confirmation below is shown either way, so
      // a signed-out caller can never tell a real username from a made-up one.
    } finally {
      setSubmitting(false);
      setForgotSent(true);
    }
  }

  if (mode === 'forgot') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <header className="auth-head">
            <img src={liahLogo} alt="LIAH Learning" className="auth-mark" />
            <h1>Forgot your password?</h1>
          </header>

          {forgotSent ? (
            <p>If that username exists, an admin has been notified.</p>
          ) : (
            <form onSubmit={(e) => void handleForgotSubmit(e)} className="auth-form">
              <div className="auth-fields">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                  aria-label="Username"
                  autoComplete="username"
                  required
                />
              </div>

              <button type="submit" className="auth-submit" disabled={submitting} aria-busy={submitting}>
                {submitting ? 'Working…' : 'Notify admin'}
              </button>
            </form>
          )}

          <p className="auth-switch">
            <button
              type="button"
              className="auth-toggle"
              onClick={() => {
                setMode('login');
                setForgotSent(false);
              }}
            >
              Back to sign in
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <header className="auth-head">
          <img src={liahLogo} alt="LIAH Learning" className="auth-mark" />
          <h1>{mode === 'login' ? 'Sign in to your account' : 'Create your account'}</h1>
        </header>

        <form onSubmit={handleSubmit} className="auth-form">
          {/* The fields read as one control: a shared outline with the
              shared edges collapsed, so the group looks joined rather than
              stacked. Labels are visually replaced by placeholders, so each
              input carries an aria-label for screen readers. */}
          <div className="auth-fields">
            {mode === 'login' ? (
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                aria-label="Username"
                autoComplete="username"
                required
              />
            ) : (
              <>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  aria-label="First name"
                  autoComplete="given-name"
                  required
                />
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  aria-label="Last name"
                  autoComplete="family-name"
                  required
                />
              </>
            )}
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

          {mode === 'login' && (
            <button
              type="button"
              className="auth-toggle"
              onClick={() => {
                setMode('forgot');
                setForgotSent(false);
                setError(null);
              }}
            >
              Forgot password?
            </button>
          )}
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
