-- Demo data: one organisation, two guideline sets, a campaign with six ideas,
-- and four people whose consent records exercise every branch of the gate.
-- Fixed UUIDs so the file is re-runnable and easy to reference from tests.

insert into organizations (id, name, slug) values
  ('11111111-1111-1111-1111-111111111111', 'Northside Athletics', 'northside')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- guidelines

insert into guideline_sets (id, org_id, kind, name) values
  ('21111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'craft', 'Vertical video craft rules'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'brand', 'Northside brand rules')
on conflict (id) do nothing;

insert into guideline_versions (id, set_id, version, body) values
  ('31111111-1111-1111-1111-111111111111',
   '21111111-1111-1111-1111-111111111111', 1,
   '{"summary": "Shoot it so it works on a phone, held upright.",
     "items": [
       {"id": "vertical",  "text": "Hold the phone upright. Vertical, 9:16.", "required": true},
       {"id": "length",    "text": "Keep it between 10 and 30 seconds.", "required": true},
       {"id": "light",     "text": "Face the light. Never shoot into it.", "required": true},
       {"id": "safety",    "safety": true, "required": true, "text": "Never film while walking, on stairs, near traffic, or anywhere it puts you or anyone else at risk. Stop, plant your feet, then record."},
       {"id": "steady",    "text": "Brace your elbows. Let the shot settle before you start.", "required": false},
       {"id": "headroom",  "text": "Leave space at the top and bottom for captions.", "required": false},
       {"id": "sound",     "text": "If someone is talking, kill the background music.", "required": false}
     ]}'::jsonb),
  ('32222222-2222-2222-2222-222222222222',
   '22222222-2222-2222-2222-222222222222', 1,
   '{"summary": "What we sound like, and what never goes out.",
     "items": [
       {"id": "no-alcohol",   "text": "No alcohol, vaping, or gambling in frame.", "required": true},
       {"id": "no-competitor","text": "No competitor logos or apparel.", "required": true},
       {"id": "no-records",   "text": "No grades, schedules, rosters, ID cards, or anything else private about a student visible.", "required": true},
       {"id": "tone",         "text": "Talk like a student, not a brochure.", "required": false}
     ]}'::jsonb)
on conflict (id) do nothing;

-- ------------------------------------------------------------ campaign/ideas

insert into campaigns (id, org_id, name, starts_on) values
  ('41111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'Fall semester', current_date - 14)
on conflict (id) do nothing;

insert into ideas (
  id, campaign_id, title, brief, format_spec, guideline_set_ids,
  media_type, orientation, allowed_image_formats,
  min_duration_seconds, max_duration_seconds
) values
  ('51111111-1111-1111-1111-111111111111', '41111111-1111-1111-1111-111111111111',
   'The path to practice',
   'Fifteen seconds of the route you take from your last class to practice — filmed standing still. Pick a spot, plant your feet, let people walk past you. Never film while walking.',
   '{"kind":"video","orientation":"portrait","min_seconds":10,"max_seconds":30}'::jsonb,
   array['21111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222']::uuid[],
   'video', 'portrait', null, 10, 30),

  ('52222222-2222-2222-2222-222222222222', '41111111-1111-1111-1111-111111111111',
   'What is in your bag',
   'Empty your bag on a bench and name three things in it. One of them should be strange.',
   '{"kind":"video","orientation":"portrait","min_seconds":15,"max_seconds":45}'::jsonb,
   array['21111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222']::uuid[],
   'video', 'portrait', null, 15, 45),

  ('53333333-3333-3333-3333-333333333333', '41111111-1111-1111-1111-111111111111',
   'Pre-game, ninety minutes out',
   'The room ninety minutes before a game. Wide shot, hold it steady, let it run. No narration.',
   '{"kind":"video","orientation":"portrait","min_seconds":10,"max_seconds":30}'::jsonb,
   array['21111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222']::uuid[],
   'video', 'portrait', null, 10, 30),

  ('54444444-4444-4444-4444-444444444444', '41111111-1111-1111-1111-111111111111',
   'Teach us one thing',
   'Ten seconds teaching one small skill from your sport. Assume we know nothing.',
   '{"kind":"video","orientation":"portrait","min_seconds":8,"max_seconds":25}'::jsonb,
   array['21111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222']::uuid[],
   'video', 'portrait', null, 8, 25),

  ('55555555-5555-5555-5555-555555555555', '41111111-1111-1111-1111-111111111111',
   'The unglamorous part',
   'The part nobody posts: the laundry, the ice bath, the 6am bus. One shot.',
   '{"kind":"video","orientation":"portrait","min_seconds":10,"max_seconds":30}'::jsonb,
   array['21111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222']::uuid[],
   'video', 'portrait', null, 10, 30),

  ('56666666-6666-6666-6666-666666666666', '41111111-1111-1111-1111-111111111111',
   'Your view right now',
   'One photo of whatever is in front of you at this exact moment. Do not tidy up first.',
   '{"kind":"photo","orientation":"any"}'::jsonb,
   array['22222222-2222-2222-2222-222222222222']::uuid[],
   'photo', 'any', array['image/jpeg','image/png','image/webp'], null, null)
on conflict (id) do nothing;

-- ------------------------------------------------------------------- people

-- Sign-in links these rows by email on first authentication; auth_user_id stays
-- null until then. Replace the addresses before seeding a real project.
insert into people (id, org_id, role, display_name, email, birth_year) values
  ('61111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'admin',    'Dana Reyes',     'dana@example.edu',   1988),
  ('62222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'reviewer', 'Marketing desk', 'social@example.edu', 1995),
  ('63333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'student',  'Ali Haddad',     'ali@example.edu',    extract(year from now())::int - 21),
  ('64444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   'student',  'Jo Mercer',      'jo@example.edu',     extract(year from now())::int - 16),
  -- Birth year deliberately unknown: exercises the `age_unknown` blocker.
  ('65555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
   'student',  'Sam Okafor',     'sam@example.edu',    null)
on conflict (id) do nothing;

-- Demo students are moved to `active` explicitly. New rows default to
-- `pending`: a roster row is not an approval (rule 7).
update people set participation = 'active', participation_changed_at = now()
 where org_id = '11111111-1111-1111-1111-111111111111' and role = 'student';

-- Ali is an adult with a live release: clear to publish.
-- Jo is a minor with a release but no parental consent: blocked.
-- Sam has a release but no known age: blocked.
insert into consents (person_id, type, document_version, signed_by) values
  ('63333333-3333-3333-3333-333333333333', 'media_release', 'release-2026-01', 'Ali Haddad'),
  ('64444444-4444-4444-4444-444444444444', 'media_release', 'release-2026-01', 'Jo Mercer'),
  ('65555555-5555-5555-5555-555555555555', 'media_release', 'release-2026-01', 'Sam Okafor')
on conflict do nothing;
