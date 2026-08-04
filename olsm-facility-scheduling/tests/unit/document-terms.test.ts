import { describe, expect, it } from "vitest";
import { DocumentType } from "@prisma/client";
import { AGREEMENT_TERMS, FACILITY_USE_TERMS, WAIVER_TERMS } from "@/app/sign/[token]/terms";

/**
 * A signature is only worth what the signer was shown.
 *
 * The Facility Use Agreement used to render the waiver's text, because the
 * page picked terms with "the annual one, or else the waiver". An outside
 * group was told it was signing one instrument and shown another.
 */
describe("each document has its own terms", () => {
  it("gives the three instruments distinct opening lines", () => {
    const headings = [AGREEMENT_TERMS[0], FACILITY_USE_TERMS[0], WAIVER_TERMS[0]];
    expect(new Set(headings).size).toBe(3);
    expect(AGREEMENT_TERMS[0]).toMatch(/ANNUAL COACH/i);
    expect(FACILITY_USE_TERMS[0]).toMatch(/FACILITY USE AGREEMENT/i);
    expect(WAIVER_TERMS[0]).toMatch(/WAIVER/i);
  });

  it("does not let the facility use agreement borrow the waiver's body", () => {
    expect(FACILITY_USE_TERMS).not.toEqual(WAIVER_TERMS);
    const shared = FACILITY_USE_TERMS.filter((p) => WAIVER_TERMS.includes(p));
    expect(shared).toHaveLength(0);
  });

  it("covers what only an outside rental needs", () => {
    const body = FACILITY_USE_TERMS.join(" ").toLowerCase();
    for (const topic of ["insurance", "additional insured", "damage", "cancel", "supervis"]) {
      expect(body).toContain(topic);
    }
  });

  it("still marks every draft as pending legal review", () => {
    // These are placeholders until counsel approves them; a heading that stops
    // saying so is how a draft quietly becomes the thing people rely on.
    for (const terms of [AGREEMENT_TERMS, FACILITY_USE_TERMS, WAIVER_TERMS]) {
      expect(terms[0]).toMatch(/DRAFT/i);
    }
  });

  it("names every document type the system can ask somebody to sign", () => {
    // The signing page maps type -> terms and refuses to render anything it
    // cannot map. This is the list that has to stay in step with it.
    const signable: DocumentType[] = [
      DocumentType.ANNUAL_COACH_AGREEMENT,
      DocumentType.FACILITY_USE_AGREEMENT,
      DocumentType.LIABILITY_WAIVER,
      DocumentType.MINOR_PARTICIPANT_WAIVER,
      DocumentType.CAMP_ADDENDUM,
    ];
    // CERTIFICATE_OF_INSURANCE is uploaded, never signed in-app.
    expect(signable).not.toContain(DocumentType.CERTIFICATE_OF_INSURANCE);
    expect(signable).toHaveLength(Object.values(DocumentType).length - 1);
  });
});
