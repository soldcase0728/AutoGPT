/**
 * Row shapes for the tables in supabase/migrations. Hand-written rather than
 * generated so the scaffold has no build-time dependency on a live project;
 * `supabase gen types typescript` can replace this file wholesale later.
 */

export type PersonRole = "student" | "reviewer" | "admin";
export type ConsentType = "media_release" | "parental" | "nil";
export type CaptureKind = "video" | "photo";
export type ScanState = "pending" | "clean" | "infected" | "failed";
export type CaptureState =
  | "uploading"
  | "submitted"
  | "in_review"
  | "approved"
  | "changes_requested"
  | "rejected"
  | "published";

export type ParticipationState = "pending" | "active" | "revoked";

export interface Person {
  id: string;
  org_id: string;
  auth_user_id: string | null;
  role: PersonRole;
  display_name: string;
  email: string;
  birth_year: number | null;
  /**
   * Being on the roster is not being approved. Only a person can move someone
   * to `active`; `revoked` is read-only.
   */
  participation: ParticipationState;
}

export interface GuidelineItem {
  id: string;
  text: string;
  required: boolean;
  /**
   * A physical-safety rule. Always required, always shown first, and rendered
   * with emphasis — these are the ones where ignoring the rule hurts someone.
   */
  safety?: boolean;
}

export interface GuidelineBody {
  summary: string;
  items: GuidelineItem[];
}

export interface GuidelineVersion {
  id: string;
  set_id: string;
  version: number;
  body: GuidelineBody;
}

export interface FormatSpec {
  kind: CaptureKind;
  orientation: "portrait" | "landscape" | "any";
  min_seconds?: number;
  max_seconds?: number;
}

export interface Idea {
  id: string;
  title: string;
  brief: string;
  format_spec: FormatSpec;
  reference_urls: string[];
  guideline_set_ids: string[];
}

export interface Assignment {
  id: string;
  idea_id: string;
  person_id: string;
  due_on: string;
  completed_at: string | null;
}

export interface ConsentBlocker {
  person_id?: string;
  person?: string;
  reason: string;
  detail?: string;
}

/** One row of the `review_queue` view. */
export interface QueueRow {
  id: string;
  org_id: string;
  person_id: string;
  student: string;
  state: CaptureState;
  kind: CaptureKind;
  mime: string | null;
  duration_s: number | null;
  width: number | null;
  height: number | null;
  master_bytes: number | null;
  bucket: string;
  storage_key: string;
  proxy_key: string | null;
  scan_status: ScanState;
  exif_stripped: boolean;
  no_people_in_frame: boolean;
  checklist_ticked: string[];
  created_at: string;
  submitted_at: string | null;
  one_liner: string | null;
  location_label: string | null;
  idea_id: string;
  idea_title: string;
  idea_brief: string;
  format_spec: FormatSpec;
  campaign_name: string;
  consent_blockers: ConsentBlocker[];
}
