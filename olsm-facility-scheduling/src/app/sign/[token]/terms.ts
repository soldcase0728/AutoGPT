/**
 * PLACEHOLDER agreement language.
 *
 * This is scaffolding so the signing flow is testable end to end. It is not
 * legal advice and has not been reviewed by counsel. Before OLSM uses this
 * system for a real booking, replace both documents with wording approved by
 * the school's attorney and insurance carrier -- see DECISIONS.md.
 */

export const AGREEMENT_TERMS: string[] = [
  "ANNUAL COACH FACILITY USE AGREEMENT (DRAFT — PENDING LEGAL REVIEW)",
  "By signing, I acknowledge that I have read and will follow Orchard Lake St. Mary's Preparatory's rules for the use of athletic facilities, including access hours, supervision requirements, and the condition in which spaces must be left.",
  "Supervision. I will not permit students or guests to use a facility without a qualified adult present, and I will remain responsible for supervision for the whole of any booking made in my name.",
  "Emergency procedures. I acknowledge that I have been shown the location of emergency equipment including automated external defibrillators, and that I know the school's emergency action plan for the facilities I use.",
  "Concussion protocol. I acknowledge the school's concussion recognition and return-to-play protocol and my obligations under it.",
  "Outside paid instruction. I will not use school facilities for private lessons, personal training, camps or clinics from which I or a third party receive payment, unless that use is booked through this system as private instruction and has cleared the required agreement, waiver, insurance and payment requirements. I understand this applies to me regardless of my role at the school.",
  "Indemnification. To the extent permitted by law, I agree to indemnify and hold harmless Orchard Lake St. Mary's Preparatory, its trustees, officers, employees and agents from claims arising out of my use of the facilities, other than claims arising from the school's own negligence.",
  "Term. This agreement covers the current school year and expires on 31 July.",
];

export const WAIVER_TERMS: string[] = [
  "LIABILITY WAIVER AND RELEASE (DRAFT — PENDING LEGAL REVIEW)",
  "In consideration of being permitted to use the athletic facilities of Orchard Lake St. Mary's Preparatory, I acknowledge that participation in athletic activity carries inherent risks of injury, including serious injury.",
  "Assumption of risk. I voluntarily assume those risks, whether known or unknown, and confirm that each participant under my supervision is physically able to take part in the activity described in this booking.",
  "Release. To the extent permitted by law, I release Orchard Lake St. Mary's Preparatory, its trustees, officers, employees, volunteers and agents from liability for injury, loss or damage arising out of the use of the facility described in this booking, other than that arising from the school's own negligence.",
  "Condition of the facility. I will inspect the space before use and will not use it if it appears unsafe. I will report any damage or hazard to the athletic office immediately.",
  "Insurance. Where required by the booking, I confirm that current general liability insurance is in force naming the school as an additional insured, and that it will remain in force through the date of the booking.",
  "Minors. If any participant is under 18, this release must be signed by that participant's parent or legal guardian.",
  "Medical treatment. I authorize the school to arrange emergency medical care if needed and accept responsibility for the cost of that care.",
];

/**
 * The per-booking agreement an outside group signs. Distinct from the annual
 * one a coach signs: this binds a named organisation for a single reservation,
 * and carries the insurance, damage and cancellation terms that only apply when
 * somebody outside the school is using a space.
 */
export const FACILITY_USE_TERMS: string[] = [
  "FACILITY USE AGREEMENT (DRAFT — PENDING LEGAL REVIEW)",
  "This agreement covers the single reservation identified above. The organisation named on the booking is responsible for everything in it, whether or not the individual signing remains involved.",
  "Permitted use. The space may be used only for the activity described in the booking, only by the group named, and only during the reserved hours including any setup and teardown time shown.",
  "Supervision. A responsible adult from the organisation will be present for the entire reservation. Participants may not be left unsupervised at any time, and areas of the building outside the reserved space are not included.",
  "Condition and damage. The space will be inspected before and after use and left as it was found. The organisation is responsible for the cost of repairing or replacing anything damaged beyond ordinary wear during the reservation.",
  "Insurance. The organisation will maintain commercial general liability insurance naming Orchard Lake St. Mary's Preparatory as an additional insured, valid through the date of the reservation, and will provide a certificate before the booking is confirmed.",
  "Cancellation. Refunds follow the cancellation schedule shown on the booking. The school may cancel a reservation when the facility becomes unavailable or when a school activity requires the space, and will refund in full when it does.",
  "Indemnification. To the extent permitted by law, the organisation agrees to indemnify and hold harmless Orchard Lake St. Mary's Preparatory, its trustees, officers, employees and agents from claims arising out of its use of the facilities, other than claims arising from the school's own negligence.",
  "Compliance. The organisation will follow the school's rules for the building, including access hours, prohibited equipment, and any restriction posted in the space.",
];
