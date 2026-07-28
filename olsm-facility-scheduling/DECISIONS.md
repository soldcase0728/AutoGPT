# Open decisions

Every `[DECIDE]` item from the brief, what the code currently does, where to
change it, and what it blocks.

**Nothing here blocks scheduling.** Phases 1–2 (calendar, conflict prevention,
season allocation, coach self-service) work as built. These items block taking
money from, or accepting liability for, an outside organisation.

---

## 1. Rate card — hourly rates, internal camp rates, deposits, surcharges

**Status:** placeholder. Every dollar figure in the system is invented.

Seeded model: a base commercial hourly rate per facility, multiplied by tier.

| Facility | Commercial base/hr | Facility | Commercial base/hr |
|---|---|---|---|
| Petry/Ziemba Stadium | $300 | Milewski Field | $120 |
| Dombrowski Fieldhouse | $200 | Running Track | $100 |
| Rakoczy Gymnasium | $180 | Weight Room | $120 |
| Athletic Complex | $150 | Crew House | $120 |

Tier multipliers: Internal ×0 · Parish/partner ×0.35 · OLSM-affiliated club ×0.4
· Non-profit ×0.6 · Commercial ×1.0

Full-day rate caps at 6× hourly. External rental deposit $500. Surcharges:
lights $75/hr, custodial $50/hr, supervision $45/hr, athletic trainer $65/hr.

**Change at:** Admin → Rate cards (no deploy). Seed defaults in
`prisma/seed.ts` (`BASE_HOURLY_CENTS`, `TIER_MULTIPLIER`, `DEPOSIT_CENTS`).

**Note on internal camp rates:** `SCHOOL_CAMP` at the INTERNAL tier is currently
$0, so an OLSM-run camp is free. If the school wants camps to carry facility
cost internally, set that rate — the plumbing already bills it.

**Blocks:** any external booking. An unpriced booking is flagged
`invoice.unpriced` in the audit log rather than silently confirming at $0.

---

## 2. MHSAA out-of-season contact rules

**Status:** configurable flag, deliberately not encoded.

`TEAM_OFFSEASON` rules carry `mhsaaComplianceFlag = true`, which shows the
requester a warning and notifies the AD. The system does **not** attempt to
enforce MHSAA rules, because they change and misencoding them is worse than not
encoding them.

**Do:** confirm the current rules against MHSAA's published handbook — not
against this document or any summary of it — and decide whether the flag should
become a hard block for specific sports or seasons.

**Change at:** Admin → Approval rules → out-of-season rows.

---

## 3. Insurance minimums and additional-insured language

**Status:** placeholder text, no limits asserted.

Current text (`src/services/document-service.ts`, `INSURANCE_REQUIREMENT_TEXT`,
and the requester-facing copy in
`src/app/portal/bookings/[id]/insurance-text.ts`):

> Commercial general liability naming Orchard Lake St. Mary's Preparatory as an
> additional insured. Limits to be confirmed with the school's carrier and
> counsel before launch.

Commonly $1M per occurrence / $2M aggregate, but **confirm with OLSM's carrier**
rather than adopting that figure. The system enforces *that a valid certificate
exists and covers the event date*; it does not read limits off the PDF. Whoever
accepts a certificate in the admin UI is attesting the limits are adequate.

**Blocks:** club, external and private-instruction bookings.

---

## 4. Document retention, especially for minors

**Status:** nothing is deleted. No retention policy is implemented.

Signed documents are stored immutably under `documents/<year>/<id>/`, which
makes a prefix-based retention sweep straightforward when the policy exists.

Typical shape (confirm with counsel): 7 years for adult records; for minors,
often until the participant turns 18 **plus** the statute-of-limitations period,
which can mean holding a waiver 20+ years.

**Decide:** retention period per document type, whether minor waivers are held
separately, and who authorises deletion. Note that audit log entries are
append-only by design — a retention policy that requires deleting them conflicts
with the liability paper trail, so scope it to stored files.

---

## 5. Rate tier for Polish Mission / parish / alumni / Orchard Lake Schools

**Status:** `PARISH_PARTNER` tier exists at ×0.35 and is seeded onto "Orchard
Lake Polish Mission". Approval path is the standard external path.

**Decide:** which entities qualify; whether they should skip the COI requirement
(currently they do not); whether they route to a different approver.

**Change at:** Admin → People / organisations for tier assignment; Admin →
Approval rules for a distinct path.

---

## 6. Cancellation and refund windows

**Status:** implemented as the brief's suggested default, per activity type.

- Full refund 14+ days out
- 50% from 3 to 13 days
- No refund inside 72 hours

A booking **bumped** by higher-priority school activity is always refunded in
full regardless of window — the bumped party did nothing wrong. Weather
cancellations use the same waiver (admin ticks "refund in full regardless").

**Change at:** Admin → Approval rules, per activity type. Every booking freezes
the policy in force when it was created, so a change never alters an existing
booking's terms.

---

## 7. Sub-space names — Athletic Complex and Crew House

**Status:** placeholders, flagged in both facilities' descriptions.

- **St. Mary's Athletic Complex:** Whole complex, Field 1, Field 2, Field 3,
  Diamond 1, Diamond 2
- **Crew House:** Boat bay, Erg room, Dock

"Whole complex" is configured to block all five sub-spaces. The Crew House
sub-spaces are independent — confirm whether the dock and boat bay actually
conflict in practice.

**Change at:** Admin → Facilities (names and conflict rules, no deploy).

---

## 8. Routing for non-athletic department requests

**Status:** `SCHOOL_EVENT` routes to the athletic office (FACILITY_ADMIN), same
as everything else.

**Decide:** whether Mass, admissions events, banquets and alumni events should
route to a separate operations approver instead of the AD.

**If yes:** the rules table already supports role-based routing. Add an
operations role to the `Role` enum and point the `SCHOOL_EVENT` rule's approval
step at it — a small, contained change in `createApprovalSteps`.

---

## Also worth deciding

**Google Calendar IDs.** Each facility needs its calendar id set (Admin →
Facilities). Until then, confirmed bookings are marked `FAILED` sync with an
explanatory error and an admin alert, rather than being silently absent.

**Who accepts a certificate of insurance.** Any admin can currently mark one
accepted. If that should be restricted to the business office, tighten it.

**Waiver signature standard.** The `manual` e-sign provider records a typed
name, timestamp and IP address. Whether that meets OLSM's evidentiary bar, or
whether DocuSign/Dropbox Sign is required from day one, is a counsel question.
This applies to participant waivers too, where the volume is highest — a single
camp can generate a hundred typed signatures.

**Participant waivers are not a confirmation gate.** They block the *event*, not
the booking: a camp confirms months before its roster exists, so the system
chases waivers by email in the 72 hours beforehand and shows the shortfall on
the booking. Decide whether the athletic office wants a harder stop — for
example, refusing check-in while anyone is unsigned. The data to enforce that is
already there (`rosterStatus`), it is only the policy that is undecided.

**Who may keep a security deposit, and on what evidence.** Any admin can
currently capture part of a hold, with a mandatory written reason that is
audited and emailed to the renter. If retaining money should need business-office
sign-off or photographs, that is a workflow decision to make before the first
external rental.

**Agreement and waiver wording.** `src/app/sign/[token]/terms.ts` contains
drafting scaffolding so the flow is testable end to end. It is not legal advice
and has not been reviewed. Replace before real use.

**External account creation.** A public request creates an EXTERNAL account and
emails a 7-day sign-in link. There is no CAPTCHA or rate limit on that form —
worth adding before the request page is linked publicly.
