import { useEffect } from 'react';
import { AttemptsTable } from './AttemptsTable';
import type { AdminAttempt } from '../../admin/api';

type Props = {
  userLabel: string;
  attempts: AdminAttempt[];
  onClose: () => void;
};

export function UserAttemptsModal({ userLabel, attempts, onClose }: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="admin-modal-overlay" data-testid="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2>{userLabel}&rsquo;s attempts</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="admin-modal-body">
          <AttemptsTable attempts={attempts} />
        </div>
      </div>
    </div>
  );
}
