import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv, supabaseConfigured } from "../env";
import { PREVIEW_PREFIX, demoScreensEnabled } from "../demo";

const PUBLIC_PREFIXES = [
  "/login",
  "/auth/callback",
  "/api/assignments/run", // guarded by its own shared secret
  "/manifest.webmanifest",
  "/icon.svg",
];


export async function updateSession(request: NextRequest) {
  // Served before the Supabase client is built: these screens hold nothing but
  // fixtures, and a demo deployment has no project for the client to reach.
  if (
    request.nextUrl.pathname.startsWith(PREVIEW_PREFIX) &&
    demoScreensEnabled()
  ) {
    return NextResponse.next({ request });
  }

  // A demo deployment has no Supabase project. Rather than 500 on every route,
  // send people to the screens that do work.
  if (!supabaseConfigured()) {
    if (!demoScreensEnabled()) {
      return new NextResponse(
        "This deployment has no Supabase project configured. See student_capture/README.md.",
        { status: 503, headers: { "content-type": "text/plain" } },
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = PREVIEW_PREFIX;
    url.search = "";
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.supabaseUrl(),
    publicEnv.supabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(toSet) {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Refreshes the session cookie. Must run before any redirect decision.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}
