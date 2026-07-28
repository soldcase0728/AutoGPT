"use client";

import { useActionState } from "react";
import { updateRuleAction, type AdminFormState } from "@/app/actions/admin-actions";
import { Alert, Button, inputClass } from "@/components/ui";

export interface EditableRule {
  id: string;
  requiresAdminApproval: boolean;
  requiresHeadCoachApproval: boolean;
  requiresContract: boolean;
  requiresWaiver: boolean;
  requiresCoi: boolean;
  requiresPayment: boolean;
  autoApprove: boolean;
  mhsaaComplianceFlag: boolean;
  priorityRank: number;
  refundFullDays: number;
  refundPartialDays: number;
  refundPartialPercent: number;
  documentHoldHours: number;
  paymentHoldHours: number;
}

const GATES: { name: keyof EditableRule; label: string; hint: string }[] = [
  { name: "autoApprove", label: "Auto-approve", hint: "Skips the approval queue entirely." },
  { name: "requiresAdminApproval", label: "Admin approval", hint: "Goes to the athletic office queue." },
  { name: "requiresHeadCoachApproval", label: "Head coach OK", hint: "Routes to the head coach of the sport." },
  { name: "requiresContract", label: "Contract", hint: "Facility use agreement or camp addendum." },
  { name: "requiresWaiver", label: "Waiver", hint: "Per-booking liability release." },
  { name: "requiresCoi", label: "Certificate of insurance", hint: "Must cover the booking date." },
  { name: "requiresPayment", label: "Payment", hint: "Invoice must be paid before confirming." },
  { name: "mhsaaComplianceFlag", label: "MHSAA warning", hint: "Shows an out-of-season contact warning." },
];

const initial: AdminFormState = {};

export function RuleEditor({ rule }: { rule: EditableRule }) {
  const [state, action, pending] = useActionState(updateRuleAction, initial);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="ruleId" value={rule.id} />

      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.notice && <Alert tone="success">{state.notice}</Alert>}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-navy-800">Gates</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {GATES.map((gate) => (
            <label key={gate.name} className="flex items-start gap-2 rounded border border-navy-200 p-2 text-sm">
              <input
                type="checkbox"
                name={gate.name}
                defaultChecked={Boolean(rule[gate.name])}
                className="mt-0.5 rounded border-navy-400"
              />
              <span>
                <span className="font-medium text-navy-900">{gate.label}</span>
                <span className="block text-xs text-navy-600">{gate.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-navy-800">Priority and holds</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            name="priorityRank"
            label="Priority rank"
            hint="Lower wins a conflict and can bump."
            defaultValue={rule.priorityRank}
            min={1}
            max={999}
          />
          <NumberField
            name="documentHoldHours"
            label="Document hold (hours)"
            hint="How long the slot is held for paperwork."
            defaultValue={rule.documentHoldHours}
            min={1}
            max={2160}
          />
          <NumberField
            name="paymentHoldHours"
            label="Payment hold (hours)"
            defaultValue={rule.paymentHoldHours}
            min={1}
            max={2160}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-navy-800">Cancellation policy</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            name="refundFullDays"
            label="Full refund at or beyond (days)"
            defaultValue={rule.refundFullDays}
            min={0}
            max={365}
          />
          <NumberField
            name="refundPartialDays"
            label="Partial refund at or beyond (days)"
            defaultValue={rule.refundPartialDays}
            min={0}
            max={365}
          />
          <NumberField
            name="refundPartialPercent"
            label="Partial refund (%)"
            defaultValue={rule.refundPartialPercent}
            min={0}
            max={100}
          />
        </div>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save rule"}
      </Button>
    </form>
  );
}

function NumberField({
  name,
  label,
  hint,
  defaultValue,
  min,
  max,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue: number;
  min: number;
  max: number;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-navy-800">{label}</span>
      <input
        type="number"
        name={name}
        defaultValue={defaultValue}
        min={min}
        max={max}
        required
        className={inputClass}
      />
      {hint && <span className="mt-1 block text-xs text-navy-600">{hint}</span>}
    </label>
  );
}
