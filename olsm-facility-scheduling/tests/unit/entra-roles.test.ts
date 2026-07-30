import { describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { reconcileRole, roleFromIdentity } from "@/lib/auth/entra-roles";
import type { EntraIdentity } from "@/lib/auth/entra";

function identity(over: Partial<EntraIdentity> = {}): EntraIdentity {
  return {
    oid: "00000000-0000-0000-0000-000000000001",
    tenantId: "tenant",
    email: "coach@olsm.edu",
    name: "A Coach",
    roles: [],
    groups: [],
    ...over,
  };
}

describe("Entra app roles map to application roles", () => {
  it("reads the role names the brief uses", () => {
    expect(roleFromIdentity(identity({ roles: ["Coach"] }))).toBe(Role.HEAD_COACH);
    expect(roleFromIdentity(identity({ roles: ["Athletic Director"] }))).toBe(Role.FACILITY_ADMIN);
    expect(roleFromIdentity(identity({ roles: ["Facilities"] }))).toBe(Role.FACILITIES);
    expect(roleFromIdentity(identity({ roles: ["Finance"] }))).toBe(Role.FINANCE);
    expect(roleFromIdentity(identity({ roles: ["Administrator"] }))).toBe(Role.FACILITY_ADMIN);
    expect(roleFromIdentity(identity({ roles: ["System Administrator"] }))).toBe(Role.SUPER_ADMIN);
  });

  it("does not care about spacing or case in the Entra value", () => {
    expect(roleFromIdentity(identity({ roles: ["system-administrator"] }))).toBe(Role.SUPER_ADMIN);
    expect(roleFromIdentity(identity({ roles: ["ATHLETIC_DIRECTOR"] }))).toBe(Role.FACILITY_ADMIN);
  });

  it("takes the strongest of several assignments", () => {
    expect(roleFromIdentity(identity({ roles: ["Coach", "Athletic Director"] }))).toBe(
      Role.FACILITY_ADMIN,
    );
  });

  it("ignores values it does not recognise", () => {
    expect(roleFromIdentity(identity({ roles: ["Parent", "Alumni"] }))).toBeNull();
    expect(roleFromIdentity(identity())).toBeNull();
  });
});

describe("a token never quietly reduces someone's authority", () => {
  it("raises when the token grants more than the local record holds", () => {
    expect(reconcileRole(Role.HEAD_COACH, Role.FACILITY_ADMIN)).toBe(Role.FACILITY_ADMIN);
  });

  it("leaves the local role alone when the token grants less", () => {
    // A director whose group membership has not been set up yet must not be
    // demoted to coach every time they sign in.
    expect(reconcileRole(Role.FACILITY_ADMIN, Role.HEAD_COACH)).toBe(Role.FACILITY_ADMIN);
  });

  it("leaves the local role alone when the token says nothing", () => {
    expect(reconcileRole(Role.FINANCE, null)).toBe(Role.FINANCE);
  });

  it("never promotes an external renter into staff", () => {
    // A renter who is a guest in the tenant, and whose group membership somehow
    // maps to something, still stays external.
    expect(reconcileRole(Role.EXTERNAL, Role.SUPER_ADMIN)).toBe(Role.EXTERNAL);
    expect(reconcileRole(Role.EXTERNAL, Role.HEAD_COACH)).toBe(Role.EXTERNAL);
  });
});
