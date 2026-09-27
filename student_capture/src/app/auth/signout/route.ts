import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Signs out and returns to the sign-in page. POST only, so a link can't sign someone out. */
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
