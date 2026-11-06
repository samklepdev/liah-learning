import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { adminApi, type AdminCourse, type AdminUser } from '../../admin/api';
import { Pager } from '../../shared/Pager';
import { usePager } from '../../shared/usePager';
import { RestoreIcon } from '../../shell/icons';

type Tab = 'users' | 'courses';

export function RecycleBinPage() {
  const [tab, setTab] = useState<Tab>('users');

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const usersPager = usePager(usersTotal);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersBusyId, setUsersBusyId] = useState<string | null>(null);

  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [coursesBusyId, setCoursesBusyId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  const loadUsers = useCallback((page: number) => {
    setUsersLoading(true);
    adminApi
      .listDeletedUsers(page)
      .then((res) => {
        setUsers(res.items);
        setUsersTotal(res.total);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setUsersLoading(false));
  }, []);

  const loadCourses = useCallback(() => {
    setCoursesLoading(true);
    adminApi
      .listDeletedCourses()
      .then((res) => setCourses(res.items))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setCoursesLoading(false));
  }, []);

  useEffect(() => {
    if (tab === 'users') loadUsers(usersPager.page);
  }, [tab, loadUsers, usersPager.page]);

  useEffect(() => {
    if (tab === 'courses') loadCourses();
  }, [tab, loadCourses]);

  const restoreUser = async (user: AdminUser) => {
    setUsersBusyId(user.id);
    try {
      await adminApi.restoreUser(user.id);
      toast.success('User restored');
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      setUsersTotal((prev) => prev - 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore user');
    } finally {
      setUsersBusyId(null);
    }
  };

  const restoreCourse = async (course: AdminCourse) => {
    setCoursesBusyId(course.id);
    try {
      await adminApi.restoreCourse(course.id);
      toast.success('Course restored');
      setCourses((prev) => prev.filter((c) => c.id !== course.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore course');
    } finally {
      setCoursesBusyId(null);
    }
  };

  return (
    <div className="admin-page">
      <h1>Recycle Bin</h1>

      <div className="recycle-bin-tabs">
        <button
          type="button"
          className={tab === 'users' ? 'recycle-bin-tab active' : 'recycle-bin-tab'}
          onClick={() => setTab('users')}
        >
          Deleted Users
        </button>
        <button
          type="button"
          className={tab === 'courses' ? 'recycle-bin-tab active' : 'recycle-bin-tab'}
          onClick={() => setTab('courses')}
        >
          Deleted Courses
        </button>
      </div>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      {tab === 'users' &&
        (usersLoading ? (
          <p>Loading…</p>
        ) : (
          <>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th>Deleted</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td data-label="Username">{u.username}</td>
                    <td data-label="First Name">{u.firstName ?? '—'}</td>
                    <td data-label="Last Name">{u.lastName ?? '—'}</td>
                    <td data-label="Deleted">
                      {u.deletedAt ? new Date(u.deletedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="admin-actions">
                      <button
                        type="button"
                        className="icon-button"
                        disabled={usersBusyId === u.id}
                        onClick={() => void restoreUser(u)}
                        aria-label="Restore"
                        title="Restore"
                      >
                        <RestoreIcon className="icon-button-icon" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager
              page={usersPager.page}
              totalPages={usersPager.totalPages}
              canPrev={usersPager.canPrev}
              canNext={usersPager.canNext}
              onPrev={usersPager.prev}
              onNext={usersPager.next}
            />
          </>
        ))}

      {tab === 'courses' &&
        (coursesLoading ? (
          <p>Loading…</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Course</th>
                <th>Deleted</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.id}>
                  <td data-label="Subject">{c.subjectTitle}</td>
                  <td data-label="Course">{c.title}</td>
                  <td data-label="Deleted">
                    {c.deletedAt ? new Date(c.deletedAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="admin-actions">
                    <button
                      type="button"
                      className="icon-button"
                      disabled={coursesBusyId === c.id}
                      onClick={() => void restoreCourse(c)}
                      aria-label="Restore"
                      title="Restore"
                    >
                      <RestoreIcon className="icon-button-icon" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </div>
  );
}
