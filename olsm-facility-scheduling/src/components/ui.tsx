import type { ReactNode } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { BookingStatus } from "@prisma/client";
import { STATUS_LABELS } from "@/domain/booking-state";

export function Card({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("rounded-lg border border-navy-200 bg-white shadow-sm", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-navy-100 px-4 py-3 sm:px-5">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p className="mt-1 text-sm text-navy-600">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

const STATUS_TONE: Record<BookingStatus, string> = {
  DRAFT: "bg-navy-100 text-navy-700",
  PENDING_APPROVAL: "bg-gold-100 text-gold-900",
  APPROVED: "bg-gold-100 text-gold-900",
  AWAITING_DOCUMENTS: "bg-gold-100 text-gold-900",
  AWAITING_PAYMENT: "bg-gold-100 text-gold-900",
  CONFIRMED: "bg-emerald-100 text-emerald-900",
  CHECKED_IN: "bg-emerald-100 text-emerald-900",
  COMPLETED: "bg-navy-100 text-navy-700",
  CANCELLED: "bg-navy-100 text-navy-600",
  DENIED: "bg-rose-100 text-rose-900",
  EXPIRED: "bg-navy-100 text-navy-600",
  NO_SHOW: "bg-rose-100 text-rose-900",
};

export function StatusBadge({ status }: { status: BookingStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_TONE[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warn" | "danger" | "good";
}) {
  const tones = {
    neutral: "bg-navy-100 text-navy-700",
    warn: "bg-gold-100 text-gold-900",
    danger: "bg-rose-100 text-rose-900",
    good: "bg-emerald-100 text-emerald-900",
  };
  return (
    <span className={clsx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const variants = {
    primary: "bg-navy-800 text-white hover:bg-navy-700 disabled:bg-navy-300",
    secondary: "border border-navy-300 bg-white text-navy-800 hover:bg-navy-50",
    danger: "bg-rose-700 text-white hover:bg-rose-800",
    ghost: "text-navy-700 hover:bg-navy-100",
  };
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex items-center justify-center rounded-md px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed",
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = "primary",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const variants = {
    primary: "bg-navy-800 text-white hover:bg-navy-700",
    secondary: "border border-navy-300 bg-white text-navy-800 hover:bg-navy-50",
  };
  return (
    <Link
      href={href}
      className={clsx(
        "inline-flex items-center justify-center rounded-md px-3.5 py-2 text-sm font-medium transition",
        variants[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-navy-800">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-navy-600">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs font-medium text-rose-800">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  "w-full rounded-md border border-navy-300 bg-white px-3 py-2 text-sm text-navy-900 " +
  "placeholder:text-navy-400 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-gold-400";

export function Alert({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "warn" | "danger" | "success";
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    info: "border-navy-300 bg-navy-50 text-navy-900",
    warn: "border-gold-400 bg-gold-50 text-gold-950",
    danger: "border-rose-300 bg-rose-50 text-rose-950",
    success: "border-emerald-300 bg-emerald-50 text-emerald-950",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={clsx("rounded-md border p-3 text-sm", tones[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={clsx(title && "mt-1")}>{children}</div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-navy-300 p-6 text-center">
      <p className="font-medium text-navy-800">{title}</p>
      {children && <div className="mt-1 text-sm text-navy-600">{children}</div>}
    </div>
  );
}

/** Tables scroll horizontally on a phone rather than breaking the layout. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">{children}</div>;
}

export function Table({ children }: { children: ReactNode }) {
  return <table className="w-full min-w-[36rem] border-collapse text-sm">{children}</table>;
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={clsx("border-b border-navy-200 py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-navy-600", className)}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={clsx("border-b border-navy-100 py-2.5 pr-3 align-top", className)}>{children}</td>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-navy-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-navy-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-navy-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-navy-600">{hint}</p>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1>{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-navy-600">{description}</p>}
      </div>
      {action}
    </div>
  );
}
