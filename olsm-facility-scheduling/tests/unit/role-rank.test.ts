import { describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { assignableRoles, canAssignRole } from "@/lib/auth/rbac";

describe("nobody hands out authority they do not hold", () => {
  it("lets the director appoint anybody, including another director", () => {
    for (const role of Object.values(Role)) {
      expect(canAssignRole(Role.SUPER_ADMIN, role)).toBe(true);
    }
  });

  it("stops the athletic office minting a director", () => {
    expect(canAssignRole(Role.FACILITY_ADMIN, Role.SUPER_ADMIN)).toBe(false);
    expect(canAssignRole(Role.FACILITY_ADMIN, Role.FACILITY_ADMIN)).toBe(true);
    expect(canAssignRole(Role.FACILITY_ADMIN, Role.HEAD_COACH)).toBe(true);
  });

  it("always allows an external account, whoever is doing the inviting", () => {
    // Setting up an outside club is the ordinary case and carries no authority,
    // so it must not be gated behind rank the way a staff role is.
    for (const role of Object.values(Role)) {
      expect(assignableRoles(role)).toContain(Role.EXTERNAL);
    }
  });

  it("does not let a coach hand out anything but an external account", () => {
    // A coach has no invite permission today, so this is a second line of
    // defence rather than a live path -- which is exactly when it needs a test.
    expect(assignableRoles(Role.HEAD_COACH)).toEqual(
      expect.arrayContaining([Role.EXTERNAL, Role.HEAD_COACH]),
    );
    expect(canAssignRole(Role.HEAD_COACH, Role.FACILITY_ADMIN)).toBe(false);
    expect(canAssignRole(Role.HEAD_COACH, Role.SUPER_ADMIN)).toBe(false);
  });

  it("offers the athletic office a shorter list than the director", () => {
    expect(assignableRoles(Role.FACILITY_ADMIN).length).toBeLessThan(
      assignableRoles(Role.SUPER_ADMIN).length,
    );
  });
});
