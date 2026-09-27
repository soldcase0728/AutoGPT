import { describe, expect, it } from "vitest";
import { REPORT_KINDS, isReportKind, reportKindLabel } from "@/lib/safety-report";

describe("report kinds", () => {
  it("puts physical safety first and 'something else' last", () => {
    expect(REPORT_KINDS[0].id).toBe("unsafe_filming");
    expect(REPORT_KINDS[REPORT_KINDS.length - 1]!.id).toBe("other");
  });

  it("accepts only known kinds", () => {
    expect(isReportKind("not_permitted")).toBe(true);
    expect(isReportKind("drop table")).toBe(false);
  });

  it("labels stored kinds, and falls back for unknown ones", () => {
    expect(reportKindLabel("not_permitted")).toBe("A teacher or coach won't allow it");
    expect(reportKindLabel("some_new_kind")).toBe("some new kind");
  });
});
