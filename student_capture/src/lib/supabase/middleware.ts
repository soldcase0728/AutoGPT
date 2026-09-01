import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "../env";

const PUBLIC_PREFIXES = [
  "/login",
  "/auth/callback",
  "/api/assignments/run", // guarded by its own shared secret
  "/manifest.webmanifest",
  "/icon.svg",
];

// Fixture-rendered screens for local development. The routes themselves 404 in
// production, so this never widens access to anything real.
const DEV_PUBLIC_PREFIXES = process.env.NODE_ENV === "production" ? [] : ["/preview"];

export async function updateSession(request: NextRequest) {
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
  const isPublic = [...PUBLIC_PREFIXES, ...DEV_PUBLIC_PREFIXES].some((p) =>
    pathname.startsWith(p),
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}
