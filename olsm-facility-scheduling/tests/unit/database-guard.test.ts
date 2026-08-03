import { describe, expect, it } from "vitest";
import { databaseNameFromUrl, isDisposableDatabase } from "@/lib/env";

/**
 * The guard on the fixture endpoints and on the e2e reset script.
 *
 * One of those endpoints deletes a compliance record and the other truncates
 * half the schema, and this function is the last thing standing between them
 * and a real database. It used to read the database name by splitting the URL
 * on "/" and taking the last piece, which is not the database name whenever the
 * connection string carries a socket directory.
 */

describe("reading the database name out of a connection URL", () => {
  it("reads a plain URL", () => {
    expect(databaseNameFromUrl("postgresql://user:pw@host:5432/olsm_facilities")).toBe(
      "olsm_facilities",
    );
  });

  it("ignores query parameters", () => {
    expect(
      databaseNameFromUrl("postgresql://user@host:5432/olsm_facilities_e2e?schema=public"),
    ).toBe("olsm_facilities_e2e");
  });

  it("is not fooled by a socket directory in the query string", () => {
    // The case that broke it: the last path-looking segment is the socket
    // directory, not the database.
    expect(
      databaseNameFromUrl(
        "postgresql://postgres@localhost:5433/olsm_facilities_e2e?schema=public&host=/tmp",
      ),
    ).toBe("olsm_facilities_e2e");
    expect(
      databaseNameFromUrl(
        "postgresql://postgres@localhost/olsm_facilities?host=/var/run/postgresql",
      ),
    ).toBe("olsm_facilities");
  });

  it("returns nothing for junk rather than guessing", () => {
    expect(databaseNameFromUrl("")).toBe("");
    expect(databaseNameFromUrl("not a url")).toBe("");
  });
});

describe("only a disposable database may be wiped", () => {
  it("accepts the suffixes the suites use", () => {
    expect(isDisposableDatabase("postgresql://h/olsm_facilities_e2e")).toBe(true);
    expect(isDisposableDatabase("postgresql://h/olsm_facilities_test")).toBe(true);
    expect(isDisposableDatabase("postgresql://h/olsm_facilities_e2e?host=/tmp")).toBe(true);
  });

  it("refuses a production database", () => {
    expect(isDisposableDatabase("postgresql://h/olsm_facilities")).toBe(false);
    expect(isDisposableDatabase("postgresql://h/postgres")).toBe(false);
  });

  it("refuses when the disposable-looking name is only in the query string", () => {
    // Otherwise a socket path could be used to talk the guard into wiping a
    // real database -- the failure the old parser was one URL shape away from.
    expect(isDisposableDatabase("postgresql://h/olsm_facilities?host=/var/run/x_e2e")).toBe(false);
  });

  it("refuses an unparseable or empty URL", () => {
    expect(isDisposableDatabase("")).toBe(false);
    expect(isDisposableDatabase("garbage")).toBe(false);
  });
});
