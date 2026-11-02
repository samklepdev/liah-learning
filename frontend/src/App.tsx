import './App.css';
import { AppRouter } from './router';
import { useAuth } from './auth/useAuth';

function SignOutBar() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <div className="topbar">
      <span>{user.email}</span>
      <button type="button" onClick={() => void logout()}>
        Sign out
      </button>
    </div>
  );
}

export default function App() {
  return (
    <>
      <SignOutBar />
      <AppRouter />
    </>
  );
}
