import { Link, useLocation } from 'react-router';

/**
 * Catch-all for paths that match no route. Deliberately outside RequireAuth —
 * a mistyped URL should say so whether or not you are signed in, rather than
 * bouncing you to a login form that implies the page exists.
 */
export function NotFoundPage() {
  const { pathname } = useLocation();

  return (
    <div className="notfound-page">
      <p className="notfound-code">404</p>
      <h1>Page not found</h1>
      <p className="notfound-path">
        Nothing is routed at <code>{pathname}</code>
      </p>
      <Link className="primary" to="/courses">
        Go to courses
      </Link>
    </div>
  );
}
