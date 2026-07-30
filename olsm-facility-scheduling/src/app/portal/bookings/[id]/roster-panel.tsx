"use client";

import { useActionState, useState } from "react";
import {
  addRosterAction,
  createWaiverLinkAction,
  type RosterFormState,
} from "@/app/actions/participant-actions";
import { Alert, Badge, Button, Field, inputClass } from "@/components/ui";

const initial: RosterFormState = {};

export interface RosterParticipant {
  id: string;
  name: string;
  email: string | null;
  isMinor: boolean;
  guardianName: string | null;
  signed: boolean;
  signingUrl: string | null;
}

/**
 * Two ways in, because organizers differ: a club with a spreadsheet pastes a
 * roster, a Saturday clinic hands out a link at the door.
 */
export function RosterPanel({
  bookingId,
  participants,
  expected,
  signed,
  existingLink,
}: {
  bookingId: string;
  participants: RosterParticipant[];
  expected: number;
  signed: number;
  existingLink: string | null;
}) {
  const [linkState, linkAction, linkPending] = useActionState(createWaiverLinkAction, initial);
  const [rosterState, rosterAction, rosterPending] = useActionState(addRosterAction, initial);
  const [showRoster, setShowRoster] = useState(participants.length === 0);

  const link = linkState.waiverLink ?? existingLink;
  const short = expected > 0 && signed < expected;

  return (
    <div className="space-y-4">
      {short ? (
        <Alert tone="warn" title={`${signed} of ${expected} participants have signed`}>
          Everyone using the facility needs a signed release. Add the rest by name, or share the
          link below with your group.
        </Alert>
      ) : participants.length > 0 && signed === participants.length ? (
        <Alert tone="success" title="Every participant on the roster has signed">
          {expected > 0 && participants.length < expected
            ? `Note that your booking expects ${expected} people and the roster has ${participants.length}.`
            : "Nothing outstanding."}
        </Alert>
      ) : null}

      {/* --- shared link --- */}
      <div className="rounded border border-navy-200 p-3">
        <h4 className="text-sm font-semibold text-navy-900">Shared signing link</h4>
        <p className="mt-1 text-sm text-navy-700">
          One link for the whole group. Anyone who opens it signs for themselves; parents can sign
          for a child.
        </p>

        {link ? (
          <div className="mt-2">
            <input
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className={`${inputClass} font-mono text-xs`}
              aria-label="Participant waiver link"
            />
            {linkState.notice && (
              <p className="mt-1 text-xs text-navy-600">{linkState.notice}</p>
            )}
          </div>
        ) : (
          <form action={linkAction} className="mt-2">
            <input type="hidden" name="bookingId" value={bookingId} />
            {linkState.error && <Alert tone="danger">{linkState.error}</Alert>}
            <Button type="submit" variant="secondary" disabled={linkPending}>
              {linkPending ? "Creating…" : "Create a signing link"}
            </Button>
          </form>
        )}
      </div>

      {/* --- roster --- */}
      <div className="rounded border border-navy-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-navy-900">
            Roster {participants.length > 0 && `(${signed}/${participants.length} signed)`}
          </h4>
          <Button type="button" variant="ghost" onClick={() => setShowRoster((v) => !v)}>
            {showRoster ? "Hide" : "Add participants"}
          </Button>
        </div>

        {showRoster && (
          <form action={rosterAction} className="mt-3 space-y-3">
            <input type="hidden" name="bookingId" value={bookingId} />

            {rosterState.error && <Alert tone="danger">{rosterState.error}</Alert>}
            {rosterState.notice && <Alert tone="success">{rosterState.notice}</Alert>}
            {rosterState.warnings && rosterState.warnings.length > 0 && (
              <Alert tone="warn" title="Some rows were skipped">
                <ul className="list-inside list-disc">
                  {rosterState.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Alert>
            )}

            <Field
              label="Paste your roster"
              htmlFor="roster"
              hint="One person per line: name, email, minor (yes/no), guardian name, guardian email. Only the name is required."
            >
              <textarea
                id="roster"
                name="roster"
                rows={5}
                placeholder={"Jane Smith, jane@example.com\nSam Smith, , yes, Jane Smith, jane@example.com"}
                className={`${inputClass} font-mono text-xs`}
              />
            </Field>

            <Field label="…or upload a CSV" htmlFor="file">
              <input id="file" name="file" type="file" accept=".csv,text/csv,text/plain" className={inputClass} />
            </Field>

            <Button type="submit" disabled={rosterPending}>
              {rosterPending ? "Adding…" : "Add to roster"}
            </Button>
          </form>
        )}

        {participants.length > 0 && (
          <ul className="mt-3 divide-y divide-navy-100">
            {participants.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  {p.name}
                  {p.isMinor && (
                    <span className="ml-2 text-xs text-navy-600">
                      minor · guardian {p.guardianName ?? "not named"}
                    </span>
                  )}
                  {p.email && <span className="block text-xs text-navy-600">{p.email}</span>}
                </span>
                {p.signed ? (
                  <Badge tone="good">Signed</Badge>
                ) : (
                  <>
                    <Badge tone="warn">Outstanding</Badge>
                    {p.signingUrl && (
                      <a href={p.signingUrl} className="text-xs underline">
                        Signing link
                      </a>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
