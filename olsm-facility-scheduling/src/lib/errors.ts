/** Errors the UI is expected to render as a message rather than a stack trace. */
export class DomainError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("CONFLICT", message, details);
    this.name = "ConflictError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "You do not have permission to do that.") {
    super("FORBIDDEN", message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends DomainError {
  constructor(what = "Record") {
    super("NOT_FOUND", `${what} not found.`);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("VALIDATION", message, details);
    this.name = "ValidationError";
  }
}

/** Blocked because a liability gate is unmet. Rendered with an action link. */
export class ComplianceError extends DomainError {
  readonly actionLabel?: string;
  readonly actionHref?: string;

  constructor(message: string, action?: { label: string; href: string }) {
    super("COMPLIANCE", message);
    this.name = "ComplianceError";
    this.actionLabel = action?.label;
    this.actionHref = action?.href;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

export function errorMessage(e: unknown): string {
  if (isDomainError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
