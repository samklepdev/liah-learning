import './App.css';
import { LoginForm } from './auth/LoginForm';
import { useAuth } from './auth/useAuth';

function Dashboard() {
  const { user, logout } = useAuth();

  return (
    <div className="dashboard">
      <h1>LIAH Learning</h1>
      <p>
        Signed in as <strong>{user?.email}</strong>
      </p>
      <button type="button" onClick={() => void logout()}>
        Sign out
      </button>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  // Without this gate the login form flashes on every reload, because the
  // httpOnly cookie can only be validated by asking the server.
  if (loading) return <div className="auth-loading">Loading…</div>;

  return user ? <Dashboard /> : <LoginForm />;
}
