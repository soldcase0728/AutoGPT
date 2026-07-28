import { readFile, writeFile } from "node:fs/promises";

/**
 * Build a self-contained visual walkthrough.
 *
 * Screenshots are inlined as data URIs because the artifact host blocks every
 * external request; a linked image would silently fail.
 */

const SHOTS = [
  "calendar-week",
  "calendar-day",
  "quick-book",
  "approvals",
  "booking-detail",
  "waiver",
  "custodial",
  "reports",
  "rules",
  "facilities-public",
];

const img = {};
for (const name of SHOTS) {
  const buf = await readFile(`screenshots/${name}.jpg`);
  img[name] = `data:image/jpeg;base64,${buf.toString("base64")}`;
}

const sections = [
  {
    id: "calendar",
    who: "Athletic Director",
    title: "One week, every facility",
    shot: "calendar-week",
    body: `Colour is the activity type, not decoration. Navy is school team activity; gold is
      anything paid. The word <em>held</em> under a booking means it is holding the slot but has
      not cleared its gates yet &mdash; the Saturday clinic and the Sunday club rental both still
      owe paperwork, and neither has reached a Google calendar. Only confirmed bookings sync.`,
  },
  {
    id: "day",
    who: "Athletic Director",
    title: "One day, spaces side by side",
    shot: "calendar-day",
    body: `The day view puts <em>spaces</em> in the columns rather than days, because the question
      an AD actually asks is &ldquo;what is in Rakoczy on Monday&rdquo;. Both halves of the gym run
      at 3:30 without conflicting, which is the sub-space model working: Court&nbsp;1 and
      Court&nbsp;2 are independent, but booking Full&nbsp;court would close both.
      Dragging across empty time starts a booking, pre-filled.`,
  },
  {
    id: "book",
    who: "Head coach",
    title: "The 30-second path",
    shot: "quick-book",
    body: `An in-season practice is six fields and a button. No approval, no contract, no payment,
      no waiting &mdash; it is confirmed on submit. Everything optional sits behind
      &ldquo;Add headcount, setup and equipment notes&rdquo;, so the common case stays short. The
      panel on the right tells a coach what will happen <em>before</em> they fill anything in.`,
  },
  {
    id: "gate",
    who: "Head coach",
    title: "The same coach, running paid lessons",
    shot: "booking-detail",
    body: `This is the case the whole design turns on. A head coach booking a Saturday shooting
      clinic is charged commercial rate and held to a facility use agreement, a liability waiver, a
      current certificate of insurance and payment &mdash; because approval keys on
      <strong>what the activity is</strong>, not who is asking. Their role buys them nothing here.
      Note the roster: one of three participants has signed.`,
  },
  {
    id: "waiver",
    who: "A parent, with no account",
    title: "Everyone on the floor signs",
    shot: "waiver",
    body: `One link per booking, handed out by the organiser. A parent dropping a child at a
      Saturday clinic is never going to have a login, so this needs none. Tick
      &ldquo;under 18&rdquo; and it asks for a guardian instead &mdash; a minor&rsquo;s waiver
      without a named guardian is rejected by the database, not just the form.`,
  },
  {
    id: "approvals",
    who: "Athletic Director",
    title: "The approval queue",
    shot: "approvals",
    body: `Each request shows what it will still owe <em>after</em> you approve it, so approving is
      never mistaken for confirming. Where something else already holds the slot, the conflict is
      named on the card rather than discovered later.`,
  },
  {
    id: "custodial",
    who: "Facilities and custodial",
    title: "The daily setup board",
    shot: "custodial",
    body: `Today and tomorrow, grouped by building, with setup notes called out and turnover time
      between bookings already calculated. Staff can check a group in from here. The same content
      goes out as a 6:00&nbsp;AM email digest.`,
  },
  {
    id: "reports",
    who: "Athletic Director and business office",
    title: "The number this exists to move",
    shot: "reports",
    body: `Revenue captured from non-team use &mdash; private instruction, club, camp and rental
      &mdash; broken out by facility, activity type and organisation for any date range. Alongside
      it: utilisation against published hours, and the compliance list of who is about to fall out
      of insurance or an unsigned agreement.`,
  },
  {
    id: "rules",
    who: "Athletic Director",
    title: "The matrix is data, not code",
    shot: "rules",
    body: `Every gate in the system is a row you can edit: who approves, what documents are
      required, how it ranks against competing requests, how long a hold survives, and the refund
      windows. Changing a rule affects future bookings only &mdash; anything already created keeps
      the terms it was created under, so an edit never rewrites history.`,
  },
  {
    id: "public",
    who: "Anyone, signed out",
    title: "The public directory",
    shot: "facilities-public",
    body: `What an outside group sees before they ask: the spaces, capacity, amenities, published
      hours and provisional rates, plus a request form that needs no account. Each facility also
      publishes a read-only calendar feed for the school website.`,
  },
];

const html = `<title>OLSM Facility Scheduling — build walkthrough</title>
<style>
  :root {
    color-scheme: light;
    --ground: #eef1f5;
    --surface: #ffffff;
    --surface-sunk: #e4e9f0;
    --ink: #101822;
    --ink-soft: #46536580;
    --text: #2c3a4d;
    --muted: #5b6b81;
    --navy: #1d3557;
    --navy-line: #c6d2e2;
    --gold: #8f5413;
    --gold-fill: #e6b52e;
    --rule: #d3dae4;
    --shadow: 0 1px 2px rgba(16, 24, 34, .06), 0 12px 32px -12px rgba(16, 24, 34, .22);

    --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
    --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --ground: #0c1218;
      --surface: #141d29;
      --surface-sunk: #0a0f15;
      --ink: #eef3f9;
      --ink-soft: #8ea3bd80;
      --text: #c3d0e0;
      --muted: #8fa1b8;
      --navy: #9dbbdf;
      --navy-line: #2b3d54;
      --gold: #e6b52e;
      --gold-fill: #b98a1c;
      --rule: #253242;
      --shadow: 0 1px 2px rgba(0, 0, 0, .5), 0 14px 36px -14px rgba(0, 0, 0, .7);
    }
  }

  :root[data-theme="dark"] {
    color-scheme: dark;
    --ground: #0c1218;
    --surface: #141d29;
    --surface-sunk: #0a0f15;
    --ink: #eef3f9;
    --ink-soft: #8ea3bd80;
    --text: #c3d0e0;
    --muted: #8fa1b8;
    --navy: #9dbbdf;
    --navy-line: #2b3d54;
    --gold: #e6b52e;
    --gold-fill: #b98a1c;
    --rule: #253242;
    --shadow: 0 1px 2px rgba(0, 0, 0, .5), 0 14px 36px -14px rgba(0, 0, 0, .7);
  }

  :root[data-theme="light"] {
    color-scheme: light;
    --ground: #eef1f5;
    --surface: #ffffff;
    --surface-sunk: #e4e9f0;
    --ink: #101822;
    --text: #2c3a4d;
    --muted: #5b6b81;
    --navy: #1d3557;
    --navy-line: #c6d2e2;
    --gold: #8f5413;
    --gold-fill: #e6b52e;
    --rule: #d3dae4;
    --shadow: 0 1px 2px rgba(16, 24, 34, .06), 0 12px 32px -12px rgba(16, 24, 34, .22);
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--ground);
    color: var(--text);
    font-family: var(--sans);
    font-size: 17px;
    line-height: 1.65;
    -webkit-font-smoothing: antialiased;
  }

  .wrap { max-width: 74rem; margin: 0 auto; padding: 0 1.5rem; }
  .prose { max-width: 40rem; }

  a { color: var(--navy); text-decoration-thickness: 1px; text-underline-offset: 2px; }
  a:focus-visible, summary:focus-visible {
    outline: 2px solid var(--gold-fill); outline-offset: 3px; border-radius: 2px;
  }

  .eyebrow {
    font-family: var(--mono);
    font-size: .6875rem;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: var(--muted);
  }

  /* ---- masthead ---- */
  header.top {
    border-bottom: 1px solid var(--rule);
    background: var(--surface);
    padding: 3.5rem 0 2.75rem;
  }
  .crest {
    display: inline-grid; place-items: center;
    width: 2.5rem; height: 2.5rem; border-radius: 4px;
    background: var(--navy); color: var(--gold-fill);
    font-family: var(--serif); font-weight: 700; font-size: 1rem;
    letter-spacing: .02em;
  }
  :root[data-theme="dark"] .crest, :root:not([data-theme="light"]) .crest { }
  @media (prefers-color-scheme: dark) { .crest { background: #1d3557; } }
  :root[data-theme="dark"] .crest { background: #1d3557; }
  :root[data-theme="light"] .crest { background: #1d3557; color: #e6b52e; }

  h1 {
    font-family: var(--serif);
    font-weight: 600;
    font-size: clamp(2rem, 1.4rem + 2.4vw, 3rem);
    line-height: 1.12;
    letter-spacing: -.015em;
    color: var(--ink);
    margin: 1.5rem 0 .75rem;
    text-wrap: balance;
  }
  .standfirst { font-size: 1.1875rem; color: var(--text); margin: 0; }

  .facts {
    display: flex; flex-wrap: wrap; gap: 0 2.5rem;
    margin-top: 2rem; padding-top: 1.5rem;
    border-top: 1px solid var(--rule);
  }
  .fact { display: grid; gap: .15rem; }
  .fact b {
    font-family: var(--mono); font-size: 1.25rem; font-weight: 500;
    color: var(--ink); font-variant-numeric: tabular-nums;
  }
  .fact span { font-family: var(--mono); font-size: .6875rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }

  /* ---- notice ---- */
  .notice {
    margin: 2.5rem 0 0;
    padding: 1rem 1.25rem;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-left: 3px solid var(--gold-fill);
    border-radius: 3px;
    font-size: .9375rem;
  }
  .notice p { margin: 0; }
  .notice p + p { margin-top: .5rem; }

  /* ---- sections ---- */
  main { padding: 3.5rem 0 1rem; display: grid; gap: 5rem; }

  .shot { display: grid; gap: 1.25rem; }
  .shot-head { display: grid; gap: .35rem; }
  .shot h2 {
    font-family: var(--serif);
    font-weight: 600;
    font-size: 1.625rem;
    line-height: 1.2;
    color: var(--ink);
    margin: 0;
    text-wrap: balance;
  }
  .shot .caption { margin: 0; max-width: 42rem; color: var(--text); }
  .shot .caption em { color: var(--ink); font-style: italic; }
  .shot .caption strong { color: var(--ink); font-weight: 600; }

  figure {
    margin: 0;
    background: var(--surface);
    border: 1px solid var(--navy-line);
    border-radius: 4px;
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  figure img { display: block; width: 100%; height: auto; }

  /* ---- closing ---- */
  .closing { background: var(--surface); border-top: 1px solid var(--rule); margin-top: 4rem; padding: 3.5rem 0; }
  .closing h2 {
    font-family: var(--serif); font-size: 1.5rem; font-weight: 600;
    color: var(--ink); margin: 0 0 1rem;
  }
  .closing h3 {
    font-family: var(--mono); font-size: .6875rem; letter-spacing: .1em;
    text-transform: uppercase; color: var(--muted); margin: 2.25rem 0 .6rem;
  }
  .closing ul { margin: 0; padding-left: 1.1rem; display: grid; gap: .4rem; }
  .closing li::marker { color: var(--gold); }

  .repo {
    margin-top: 2.5rem; padding: 1rem 1.25rem;
    background: var(--surface-sunk); border-radius: 3px;
    font-family: var(--mono); font-size: .8125rem; word-break: break-all;
  }

  footer {
    padding: 2rem 0 4rem; font-size: .8125rem; color: var(--muted);
  }

  @media (max-width: 40rem) {
    body { font-size: 16px; }
    header.top { padding: 2.5rem 0 2rem; }
    main { gap: 3.5rem; }
    .facts { gap: 0 1.5rem; }
  }
</style>

<header class="top">
  <div class="wrap">
    <span class="crest" aria-hidden="true">OL</span>
    <p class="eyebrow" style="margin:.9rem 0 0">Build walkthrough &middot; Orchard Lake St. Mary&rsquo;s Preparatory</p>
    <h1>Facility scheduling, end to end</h1>
    <p class="standfirst prose">
      Reservations for all eight athletic facilities, with the liability and payment gates that
      non-team use has to clear &mdash; and none of them in a head coach&rsquo;s way.
    </p>

    <div class="facts">
      <div class="fact"><b>171</b><span>tests passing</span></div>
      <div class="fact"><b>8</b><span>facilities, 32 spaces</span></div>
      <div class="fact"><b>12/12</b><span>acceptance criteria</span></div>
      <div class="fact"><b>0</b><span>credentials required to run</span></div>
    </div>

    <div class="notice prose">
      <p><strong>What you are looking at.</strong> Real screens from the running application,
        populated with a realistic week of demo data &mdash; team practices, a Friday contest, a
        paid clinic, a club rental and a camp.</p>
      <p>Nothing is deployed. The app ran inside a temporary container to take these, so there is
        no live URL to click; the code is on the branch linked at the bottom.</p>
    </div>
  </div>
</header>

<main class="wrap">
${sections
  .map(
    (s) => `  <section class="shot" id="${s.id}">
    <div class="shot-head">
      <p class="eyebrow">${s.who}</p>
      <h2>${s.title}</h2>
    </div>
    <p class="caption">${s.body.trim()}</p>
    <figure>
      <img src="${img[s.shot]}" alt="Screenshot: ${s.title}" loading="lazy" decoding="async">
    </figure>
  </section>`,
  )
  .join("\n\n")}
</main>

<div class="closing">
  <div class="wrap prose">
    <h2>What is proven, and what is still yours</h2>

    <h3>Verified</h3>
    <ul>
      <li>Two bookings cannot hold the same space &mdash; rejected by a database constraint, tested
        by bypassing the application entirely.</li>
      <li>Booking a full floor closes the courts inside it; the courts stay independent of each other.</li>
      <li>A coach with no signed annual agreement cannot book anything.</li>
      <li>A contest bumps a lower-priority rental, refunds it in full and notifies them automatically.</li>
      <li>The audit log cannot be edited or deleted by any role, including an administrator.</li>
      <li>132 unit and integration tests against a real database, plus 39 browser tests on desktop
        and mobile, run twice to prove they are repeatable.</li>
    </ul>

    <h3>Placeholders &mdash; decisions only OLSM can make</h3>
    <ul>
      <li>Every rate is invented. Real numbers need the athletic office and business office.</li>
      <li>Insurance minimums and additional-insured wording need your carrier.</li>
      <li>The agreement and waiver text is scaffolding, not legal language. It needs counsel.</li>
      <li>Document retention, especially for minors, needs counsel.</li>
      <li>Sub-space names at the Athletic Complex and Crew House are my best guess.</li>
    </ul>
    <p style="margin-top:1rem">
      None of these block scheduling. They block taking money from an outside organisation.
    </p>

    <h3>Worth deciding first</h3>
    <p style="margin:0">
      Price Facilitron, rSchoolToday and ML Schedules before investing further &mdash; several are
      free to schools and take a percentage of rental revenue. What they will not give you is the
      head-coach auto-approve path and the season allocation logic, which is where the actual pain
      is. A reasonable sequence: run the scheduling half now, get one season of real utilisation
      data, and let that number decide whether the payments half is worth building or renting.
    </p>

    <div class="repo">
      github.com/soldcase0728/AutoGPT<br>
      branch: claude/olsm-facility-scheduling-b4mmq5<br>
      path: olsm-facility-scheduling/
    </div>
  </div>
</div>

<footer class="wrap">
  Screens captured from the running application with seeded demo data. All names, rates and
  organisations shown are fictional.
</footer>
`;

await writeFile("walkthrough.html", html);
console.log(`walkthrough.html: ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB`);
