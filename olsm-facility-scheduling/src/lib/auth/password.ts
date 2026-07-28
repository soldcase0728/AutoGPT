import bcrypt from "bcryptjs";

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface PasswordPolicyResult {
  ok: boolean;
  message?: string;
}

export function checkPasswordPolicy(plain: string): PasswordPolicyResult {
  if (plain.length < 12) {
    return { ok: false, message: "Use at least 12 characters." };
  }
  if (!/[a-z]/.test(plain) || !/[A-Z]/.test(plain) || !/[0-9]/.test(plain)) {
    return {
      ok: false,
      message: "Use upper case, lower case and at least one number.",
    };
  }
  return { ok: true };
}

/** URL-safe random token for email verification and public waiver links. */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString("base64url");
}
