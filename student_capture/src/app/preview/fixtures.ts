import { buildChecklist } from "@/lib/guidelines";
import type { GuidelineVersion, Idea, Person, QueueRow } from "@/lib/types";
import type { SubmissionRow } from "@/components/views/SubmissionsView";

/**
 * Fixtures for the dev-only preview screens. Shaped exactly like what the
 * queries in the real pages return, so the preview exercises the same views
 * rather than a parallel mock-up of them.
 */

export const STUDENT: Person = {
  id: "63333333-3333-3333-3333-333333333333",
  org_id: "11111111-1111-1111-1111-111111111111",
  auth_user_id: "d0000000-0000-0000-0000-0000000000a1",
  role: "student",
  display_name: "Ali Haddad",
  email: "ali@example.edu",
  birth_year: 2005,
  participation: "active",
};

export const REVIEWER: Person = {
  ...STUDENT,
  id: "62222222-2222-2222-2222-222222222222",
  role: "reviewer",
  display_name: "Marketing desk",
  email: "social@example.edu",
  birth_year: 1995,
};

export const MINOR: Person = {
  ...STUDENT,
  id: "64444444-4444-4444-4444-444444444444",
  display_name: "Jo Mercer",
  email: "jo@example.edu",
  birth_year: new Date().getFullYear() - 16,
};

export const IDEA: Idea & { campaigns: { name: string } } = {
  id: "51111111-1111-1111-1111-111111111111",
  title: "The path to practice",
  brief:
    "Fifteen seconds of the route you take from your last class to practice — filmed standing still. Pick a spot, plant your feet, let people walk past you. Never film while walking.",
  format_spec: {
    kind: "video",
    orientation: "portrait",
    min_seconds: 10,
    max_seconds: 30,
  },
  reference_urls: [],
  guideline_set_ids: [
    "21111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
  ],
  campaigns: { name: "Fall semester" },
};

const VERSIONS: GuidelineVersion[] = [
  {
    id: "31111111-1111-1111-1111-111111111111",
    set_id: "21111111-1111-1111-1111-111111111111",
    version: 1,
    body: {
      summary: "Shoot it so it works on a phone, held upright.",
      items: [
        { id: "vertical", text: "Hold the phone upright. Vertical, 9:16.", required: true },
        { id: "length", text: "Keep it between 10 and 30 seconds.", required: true },
        { id: "light", text: "Face the light. Never shoot into it.", required: true },
        {
          id: "safety",
          safety: true,
          required: true,
          text: "Never film while walking, on stairs, near traffic, or anywhere it puts you or anyone else at risk. Stop, plant your feet, then record.",
        },
        { id: "steady", text: "Brace your elbows. Let the shot settle before you start.", required: false },
        { id: "headroom", text: "Leave space at the top and bottom for captions.", required: false },
      ],
    },
  },
  {
    id: "32222222-2222-2222-2222-222222222222",
    set_id: "22222222-2222-2222-2222-222222222222",
    version: 1,
    body: {
      summary: "What we sound like, and what never goes out.",
      items: [
        { id: "no-alcohol", text: "No alcohol, vaping, or gambling in frame.", required: true },
        { id: "no-records", text: "No grades, schedules, rosters, or ID cards visible.", required: true },
        { id: "tone", text: "Talk like a student, not a brochure.", required: false },
      ],
    },
  },
];

export const CHECKLIST = buildChecklist(VERSIONS);

export const PEOPLE = [
  { id: STUDENT.id, display_name: "Ali Haddad" },
  { id: MINOR.id, display_name: "Jo Mercer" },
  { id: "65555555-5555-5555-5555-555555555555", display_name: "Sam Okafor" },
  { id: REVIEWER.id, display_name: "Marketing desk" },
];

export const SUBMISSIONS: SubmissionRow[] = [
  {
    id: "c1",
    state: "published",
    created_at: "2026-08-28T15:02:00Z",
    submitted_at: "2026-08-28T15:04:00Z",
    ideaTitle: "Teach us one thing",
    oneLiner: "How to tape an ankle in under a minute",
  },
  {
    id: "c2",
    state: "approved",
    created_at: "2026-08-29T18:40:00Z",
    submitted_at: "2026-08-29T18:44:00Z",
    ideaTitle: "The unglamorous part",
    oneLiner: "Six in the morning, still dark, everyone silent on the bus",
  },
  {
    id: "c3",
    state: "changes_requested",
    created_at: "2026-08-30T20:10:00Z",
    submitted_at: "2026-08-30T20:12:00Z",
    ideaTitle: "What is in your bag",
    oneLiner: "Three things, one of them is a rubber duck",
  },
  {
    id: "c4",
    state: "submitted",
    created_at: "2026-08-31T16:22:00Z",
    submitted_at: "2026-08-31T16:25:00Z",
    ideaTitle: "Pre-game, ninety minutes out",
    oneLiner: "Nobody talks in here before a game",
  },
];

const baseRow = {
  org_id: STUDENT.org_id,
  // Photos rather than video: the preview has no real files, and a still lets
  // the player show a frame instead of an empty box.
  kind: "photo" as const,
  mime: "image/jpeg",
  duration_s: null,
  width: 1080,
  height: 1920,
  bucket: "captures",
  proxy_key: null,
  scan_status: "pending" as const,
  exif_stripped: false,
  no_people_in_frame: false,
  checklist_ticked: ["vertical", "length", "light", "no-alcohol", "no-records"],
  location_label: null,
  idea_id: IDEA.id,
  format_spec: IDEA.format_spec,
  campaign_name: "Fall semester",
};

export const QUEUE: QueueRow[] = [
  {
    ...baseRow,
    id: "a1b2c3d4-0000-0000-0000-000000000001",
    person_id: STUDENT.id,
    student: "Ali Haddad",
    state: "submitted",
    master_bytes: 148_293_120,
    storage_key: `${STUDENT.id}/cap1/IMG_4821.jpg`,
    created_at: "2026-09-01T13:58:00Z",
    submitted_at: "2026-09-01T14:02:00Z",
    one_liner: "Last five minutes before the bus leaves",
    idea_title: IDEA.title,
    idea_brief: IDEA.brief,
    consent_blockers: [],
  },
  {
    ...baseRow,
    id: "a1b2c3d4-0000-0000-0000-000000000002",
    person_id: MINOR.id,
    student: "Jo Mercer",
    state: "submitted",
    master_bytes: 96_468_992,
    storage_key: `${MINOR.id}/cap2/IMG_0912.jpg`,
    created_at: "2026-09-01T14:31:00Z",
    submitted_at: "2026-09-01T14:33:00Z",
    one_liner: "Sprint repeats, and the face you make on the last one",
    idea_title: "The unglamorous part",
    idea_brief: "The part nobody posts.",
    consent_blockers: [
      { person_id: MINOR.id, person: "Jo Mercer", reason: "parental_missing" },
    ],
  },
  {
    ...baseRow,
    id: "a1b2c3d4-0000-0000-0000-000000000003",
    person_id: "65555555-5555-5555-5555-555555555555",
    student: "Sam Okafor",
    state: "in_review",
    master_bytes: 201_326_592,
    storage_key: "65555555-5555-5555-5555-555555555555/cap3/IMG_1177.jpg",
    created_at: "2026-09-01T15:05:00Z",
    submitted_at: "2026-09-01T15:07:00Z",
    one_liner: "Empty gym at six, before anyone else turns up",
    idea_title: "Your view right now",
    idea_brief: "One photo of whatever is in front of you.",
    consent_blockers: [
      {
        person_id: "65555555-5555-5555-5555-555555555555",
        person: "Sam Okafor",
        reason: "age_unknown",
      },
    ],
  },
];
