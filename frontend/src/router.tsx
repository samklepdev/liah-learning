import { type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { LoginForm } from './auth/LoginForm';
import { useAuth } from './auth/useAuth';
import { CatalogLayout } from './pages/CatalogLayout';
import { NotFoundPage } from './pages/NotFoundPage';
import { QuizPage } from './pages/QuizPage';
import { ResultsPage } from './pages/ResultsPage';
import { SubjectCoursesPage, SubjectsIndexPage } from './pages/SubjectCoursesPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="auth-loading">Loading…</div>;
  if (!user) return <LoginForm />;
  return <>{children}</>;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/subjects" replace />} />
        {/* Kept so older links and bookmarks don't land on the 404 page. */}
        <Route path="/courses" element={<Navigate to="/subjects" replace />} />

        {/* Sidebar of subjects, with the selected subject's quizzes beside it. */}
        <Route
          path="/subjects"
          element={
            <RequireAuth>
              <CatalogLayout />
            </RequireAuth>
          }
        >
          <Route index element={<SubjectsIndexPage />} />
          <Route path=":subjectSlug" element={<SubjectCoursesPage />} />
        </Route>

        {/* Taking a quiz and reading a result are full-width: no sidebar, so
            nothing competes with the question in front of you. */}
        <Route
          path="/courses/:slug/quiz"
          element={
            <RequireAuth>
              <QuizPage />
            </RequireAuth>
          }
        />
        <Route
          path="/courses/:slug/results/:attemptId"
          element={
            <RequireAuth>
              <ResultsPage />
            </RequireAuth>
          }
        />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
