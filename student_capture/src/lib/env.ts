/** Environment access that fails loudly at the point of use, not silently at runtime. */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

/** True when a Supabase project is actually configured. Never throws. */
export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export const publicEnv = {
  supabaseUrl: () =>
    required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: () =>
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  captureBucket: () => process.env.NEXT_PUBLIC_CAPTURE_BUCKET || "captures",
  maxUploadBytes: () =>
    Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_BYTES || 536_870_912),
};

/** Server-only. Importing this from a client component is a build error. */
export const serverEnv = {
  serviceRoleKey: () =>
    required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY),
  cronSecret: () => required("CAPTURE_CRON_SECRET", process.env.CAPTURE_CRON_SECRET),
};
