import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip static assets, image files, the service worker, the app manifest (the browser fetches it without a login) and the wallpapers (public files that need no login check).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw\\.js$|manifest\\.webmanifest$|backgrounds/|music/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
