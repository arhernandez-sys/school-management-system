import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@features/auth/hooks/useAuth';
import {
  useAnnouncementsList,
  useNotificationCounts,
} from '@features/announcements/hooks/useAnnouncements';
import { useGradeRevisions } from '@features/grades/hooks/useRevisions';
import { ROUTES } from '@shared/constants/routes';
import type { NotificationItem } from './NotificationsBell';

/**
 * What the bell shows (D30 §D8) — **and the fix for real dead UI**.
 *
 * `NotificationsBell` was rendered with only `count` and no `items`, so its popover always
 * read "No new notifications" no matter what the badge said. The plan flagged that as a
 * genuine defect rather than a missing feature (§D8), and this hook is what closes it.
 *
 * **There is no notifications table, and there was never going to be one.** §D8 is explicit:
 * a notification here is a filtered read of something that already exists. So the list is
 * composed from two sources the app already serves —
 *
 *   * unread ANNOUNCEMENTS, which every role may have;
 *   * pending GRADE REVISIONS awaiting the viewer's decision, which only the Dean has.
 *
 * The badge count comes from `/announcements/unread-count`, which the server already sums
 * across both. This hook does not re-add them: a count assembled in the browser would drift
 * from the badge the moment one list was truncated.
 *
 * Revisions are listed FIRST. They are the only entry that is a decision somebody is waiting
 * on; an unread announcement can sit unread for a week without consequence.
 */
export interface NotificationsState {
  count: number;
  items: NotificationItem[];
  /** Navigate to whatever an item points at. */
  onSelect: (id: string) => void;
}

/** How many of each source to show. The popover is a prompt, not an inbox. */
const MAX_PER_SOURCE = 5;

export function useNotifications(): NotificationsState {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role;
  // A student and a Registrar have no revision queue at all — the endpoint answers 403 —
  // so the query is not even issued for them.
  const canSeeRevisions = role === 'principal' || role === 'teacher';

  const counts = useNotificationCounts();
  const announcements = useAnnouncementsList({ page: 1, page_size: MAX_PER_SOURCE });
  const revisions = useGradeRevisions(canSeeRevisions ? { status: 'pending' } : {});

  const items = useMemo<NotificationItem[]>(() => {
    const out: NotificationItem[] = [];

    // Revisions first: a decision is waiting on somebody.
    if (canSeeRevisions && role === 'principal') {
      for (const row of (revisions.data?.items ?? []).slice(0, MAX_PER_SOURCE)) {
        out.push({
          id: `revision:${row.id}`,
          title: `Grade revision · ${row.student?.full_name ?? 'a student'}`,
          preview: `${row.subject_code ?? row.subject_name} · ${row.original_score ?? '—'} → ${row.proposed_score} · asked by ${row.requested_by_name}`,
        });
      }
    }

    for (const row of (announcements.data?.items ?? []).slice(0, MAX_PER_SOURCE)) {
      // The list is not filtered to unread here: `is_read` is on the row, and showing a
      // recently-read announcement in the popover is useful rather than wrong. The BADGE is
      // still the server's unread count.
      if (row.is_read) continue;
      out.push({
        id: `announcement:${row.id}`,
        title: row.title,
        preview: row.body_preview || undefined,
      });
    }
    return out;
  }, [announcements.data, canSeeRevisions, revisions.data, role]);

  const onSelect = (id: string) => {
    const [kind, targetId] = id.split(':');
    if (kind === 'revision') {
      navigate(ROUTES.gradeRevisions);
      return;
    }
    if (kind === 'announcement' && targetId) {
      navigate(`${ROUTES.announcements}/${targetId}`);
    }
  };

  return { count: counts.data?.unread_count ?? 0, items, onSelect };
}
