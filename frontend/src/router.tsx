import { type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ForcedPasswordChangeForm } from './auth/ForcedPasswordChangeForm';
import { LoginForm } from './auth/LoginForm';
import { useAuth } from './auth/useAuth';
import { AdminImportPage } from './pages/admin/AdminImportPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProfilePage } from './pages/ProfilePage';
import { ProgressPage } from './pages/ProgressPage';
import { QuizPage } from './pages/QuizPage';
import { ResultsPage } from './pages/ResultsPage';
import { SubjectCoursesPage, SubjectsIndexPage } from './pages/SubjectCoursesPage';
import { AppShell } from './shell/AppShell';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="auth-loading">Loading…</div>;
  if (!user) return <LoginForm />;
  return <>{children}</>;
}

/**
 * Blocks every signed-in route — admin routes included — behind the forced
 * password-change form while mustChangePassword is true. Sits inside
 * RequireAuth, so it only ever runs once a user is known.
 */
function RequireFreshPassword({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.mustChangePassword) return <ForcedPasswordChangeForm />;
  return <>{children}</>;
}

/**
 * Renders the 404 page, not a 403, for a signed-in non-admin — a non-admin
 * should not be able to tell an admin route exists. Signed-out also 404s
 * rather than prompting sign-in, for the same reason.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="auth-loading">Loading…</div>;
  if (!user || user.role !== 'admin') return <NotFoundPage />;
  return <>{children}</>;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Signed in, "/" is just a bounce to /subjects. Signed out, it's the
            sign-out landing page — RequireAuth renders the login form here
            instead of redirecting, so the address bar reads "/" rather than
            keeping whatever page you signed out from. */}
        <Route
          path="/"
          element={
            <RequireAuth>
              <RequireFreshPassword>
                <Navigate to="/subjects" replace />
              </RequireFreshPassword>
            </RequireAuth>
          }
        />
        {/* Kept so older links and bookmarks don't land on the 404 page. */}
        <Route path="/courses" element={<Navigate to="/subjects" replace />} />

        {/* Everything signed-in shares the shell, so the sidebar is always
            reachable. Collapsing it — not routing around it — is how you get a
            distraction-free quiz. */}
        <Route
          element={
            <RequireAuth>
              <RequireFreshPassword>
                <AppShell />
              </RequireFreshPassword>
            </RequireAuth>
          }
        >
          <Route path="/subjects" element={<SubjectsIndexPage />} />
          <Route path="/subjects/:subjectSlug" element={<SubjectCoursesPage />} />
          <Route path="/courses/:slug/quiz" element={<QuizPage />} />
          <Route path="/courses/:slug/results/:attemptId" element={<ResultsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route
            path="/admin/users"
            element={
              <RequireAdmin>
                <AdminUsersPage />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/import"
            element={
              <RequireAdmin>
                <AdminImportPage />
              </RequireAdmin>
            }
          />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
