import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { adminApi, type AdminCourse } from '../../admin/api';
import { TrashIcon } from '../../shell/icons';

export function AdminCoursesPage() {
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    adminApi
      .listCourses()
      .then((res) => setCourses(res.items))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (course: AdminCourse) => {
    setBusyId(course.id);
    try {
      await adminApi.deleteCourse(course.id);
      toast.success('Course deleted');
      setCourses((prev) => prev.filter((c) => c.id !== course.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete course');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-page">
      <h1>Courses</h1>

      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Course</th>
              <th>Position</th>
              <th>Pass score</th>
              <th>Questions</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.id}>
                <td data-label="Subject">{c.subjectTitle}</td>
                <td data-label="Course">{c.title}</td>
                <td data-label="Position">{c.position}</td>
                <td data-label="Pass score">{c.passScore}</td>
                <td data-label="Questions">{c.questionCount}</td>
                <td className="admin-actions">
                  <button
                    type="button"
                    className="icon-button"
                    disabled={busyId === c.id}
                    onClick={() => void remove(c)}
                    aria-label="Delete"
                    title="Delete"
                  >
                    <TrashIcon className="icon-button-icon" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
