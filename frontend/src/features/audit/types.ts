/**
 * Audit trail types (D45 §46, §53).
 *
 * ⚠️ NOTE WHAT IS NOT HERE: no `entity_type`, no `entity_id`, no `action`, no `summary`.
 * The server renders every row into prose and named people before it leaves
 * (`app/modules/audit/narrative.py`), and this file is deliberately unable to express a
 * technical field — an auditor is shown the college, never the database.
 *
 * If a future screen "needs the id", that is a signal the narrative is missing something,
 * not that the id should be added here.
 */

/** One recorded fact that is not a before/after — "Rule waived: Course prerequisite". */
export interface AuditDetail {
  /** A registrar's word, never a JSON key. */
  label: string;
  value: string;
}

export interface AuditChange {
  /** "Score", "Letter grade", "Programme" — a registrar's word, never a column name. */
  field: string;
  previous: string | null;
  new: string | null;
}

export interface AuditEntry {
  id: number;
  /** dd/mm/yyyy, already in America/Belize. The client never re-formats it. */
  date: string;
  /** "2:14 PM", same zone. */
  time: string;
  who: string;
  /** "Dean", "Registrar", "Lecturer" — display vocabulary. */
  who_role: string | null;
  module: string;
  /** "Grade changed" — never `grade.update`. */
  what: string;
  /** The sentence. This is what the auditor actually reads. */
  description: string;
  subject: string | null;
  context: string | null;
  changes: AuditChange[];
  reason: string | null;
  ip_address: string | null;
  /**
   * WHAT KIND of record — "Grade", "Student record", "Registration". Carried over from
   * the deleted Settings → Audit log screen, which showed `entity_type` raw. Two rows
   * can read as the same sentence and be about different kinds of record, so this is
   * real information — it just must never be a table name. Unmapped types come back as
   * a flat "Record": the server's fallback fails closed.
   */
  record: string | null;
  /**
   * A quotable handle for one entry — "Entry #4821". The other thing the deleted screen
   * was legitimately used for: an auditor writing a note has to be able to name the row
   * they are challenging. It is the row's own sequential id, not a key anything accepts.
   */
  reference: string;
  /** Everything else the action recorded, in the college's words. Usually empty. */
  details: AuditDetail[];
}

export interface AuditPage {
  items: AuditEntry[];
  total: number;
  page: number;
  page_size: number;
  /** Rows predating the Phase 7 migration have no before/after; the screen says so. */
  includes_pre_phase7_rows: boolean;
}

export interface AuditActorRef {
  id: string;
  name: string;
  role: string | null;
}

export interface AuditFilters {
  modules: string[];
  actions: string[];
  actors: AuditActorRef[];
}

export interface AuditReport {
  key: string;
  name: string;
  action_count: number;
}

export interface AuditQuery {
  report?: string;
  module?: string;
  actor_user_id?: string;
  search?: string;
  from_date?: string;
  to_date?: string;
  page?: number;
  page_size?: number;
}
