import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Exchanges the emailed code for a session, then drops the student where they were headed. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }

  const failed = new URL("/login", url.origin);
  failed.searchParams.set("error", "That link has expired. Ask for a new one.");
  return NextResponse.redirect(failed);
}
