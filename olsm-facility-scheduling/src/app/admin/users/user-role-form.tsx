"use client";

import { useActionState } from "react";
import { Role } from "@prisma/client";
import { updateUserRoleAction, type AdminFormState } from "@/app/actions/admin-actions";
import { Alert, Button, inputClass } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/auth/rbac";

const initial: AdminFormState = {};

export function UserRoleForm({
  userId,
  currentRole,
  active,
}: {
  userId: string;
  currentRole: Role;
  active: boolean;
}) {
  const [state, action, pending] = useActionState(updateUserRoleAction, initial);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="userId" value={userId} />

      {state.error && (
        <div className="w-full">
          <Alert tone="danger">{state.error}</Alert>
        </div>
      )}
      {state.notice && (
        <div className="w-full">
          <Alert tone="success">{state.notice}</Alert>
        </div>
      )}

      <label className="text-sm">
        <span className="mb-1 block font-medium text-navy-800">Role</span>
        <select name="role" defaultValue={currentRole} className={inputClass}>
          {Object.values(Role).map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={active} className="rounded border-navy-400" />
        Active
      </label>

      <Button type="submit" variant="secondary" disabled={pending} className="mb-0.5">
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
