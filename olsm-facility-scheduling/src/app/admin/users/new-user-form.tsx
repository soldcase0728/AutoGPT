"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { Role } from "@prisma/client";
import { createUserAction, type AdminFormState } from "@/app/actions/admin-actions";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/auth/rbac";

const initial: AdminFormState = {};

export function NewUserForm({ assignableRoles }: { assignableRoles: Role[] }) {
  const [state, action, pending] = useActionState(createUserAction, initial);

  // React resets an uncontrolled field once the action settles, which on a
  // rejected submission throws away everything that was typed. Holding the
  // values here means a duplicate address costs one correction, not a retype.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>(
    assignableRoles.includes(Role.EXTERNAL) ? Role.EXTERNAL : assignableRoles[0],
  );
  const [organization, setOrganization] = useState("");

  useEffect(() => {
    if (state.notice) {
      setName("");
      setEmail("");
      setPhone("");
      setOrganization("");
    }
  }, [state.notice]);

  // Only an outside group belongs to an organization. Asking a coach for one
  // invites somebody to type "OLSM" and create a duplicate record.
  const external = role === Role.EXTERNAL;

  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.notice && <Alert tone="success">{state.notice}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="new-user-name">
          <input
            id="new-user-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="off"
            className={inputClass}
            placeholder="Pat Rivera"
          />
        </Field>

        <Field
          label="Email address"
          htmlFor="new-user-email"
          hint="Where the sign-in link goes. For staff, use their OLSM address so Microsoft sign-in matches it."
        >
          <input
            id="new-user-email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="off"
            className={inputClass}
            placeholder="privera@olsm.edu"
          />
        </Field>

        <Field label="Role" htmlFor="new-user-role">
          <select
            id="new-user-role"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className={inputClass}
          >
            {assignableRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Phone (optional)" htmlFor="new-user-phone">
          <input
            id="new-user-phone"
            name="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="off"
            className={inputClass}
          />
        </Field>

        {external && (
          <div className="sm:col-span-2">
            <Field
              label="Organization (optional)"
              htmlFor="new-user-organization"
              hint="The club, league or company they book on behalf of. An existing organization of the same name is reused, so insurance and invoices stay on one record."
            >
              <input
                id="new-user-organization"
                name="organization"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                autoComplete="off"
                className={inputClass}
                placeholder="Lakeshore Volleyball Club"
              />
            </Field>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add and send sign-in link"}
        </Button>
        <p className="text-xs text-navy-600">
          They receive one link to choose a password. It works once and expires in seven days.
        </p>
      </div>
    </form>
  );
}
