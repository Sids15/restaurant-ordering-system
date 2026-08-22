/**
 * Customer table sessions. A guest's device is bound to a tab by an httpOnly
 * cookie holding the tab's secret session token. Ordering follows the session
 * (not a guessable URL), and closing a tab clears its token — killing every
 * bound device. All lookups use the service-role client; customers have no RLS
 * access to tabs.
 */
import type { AstroCookies } from "astro";
import { supabaseAdmin } from "../supabase/admin";
import { openOrJoinTab, type OpenTab } from "./tabs";
import { verifyTableToken } from "./table-token";

export const TAB_COOKIE = "berlin_tab";
const MAX_AGE = 60 * 60 * 8; // 8 hours — a dining session

export interface TabSession {
  tabId: string;
  table_label: string;
}

/** The OPEN tab bound to this device's cookie, or null (missing/closed/stale). */
export async function currentSession(cookies: AstroCookies): Promise<TabSession | null> {
  const token = cookies.get(TAB_COOKIE)?.value;
  if (!token) return null;

  const { data } = await supabaseAdmin()
    .from("tabs")
    .select("id, table_label, status")
    .eq("session_token", token)
    .eq("status", "open")
    .maybeSingle();

  if (!data) return null;
  return { tabId: data.id as string, table_label: data.table_label as string };
}

function setTabCookie(cookies: AstroCookies, token: string): void {
  cookies.set(TAB_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: import.meta.env.PROD,
    maxAge: MAX_AGE,
  });
}

export type MenuAccess =
  | { mode: "ok"; table: string | null }
  | { mode: "elsewhere"; table: string };

/**
 * Decide what a guest sees at /menu or /menu/<token>. The URL segment is a
 * SIGNED table token (see table-token.ts), not a raw label — so a guessed or
 * arbitrary value can't open a tab.
 *
 *  • already bound to an open tab (browsing /menu, or re-scanning the same
 *    table) → serve it
 *  • bound to a different table → "you're seated at Table X" (no ordering here)
 *  • not bound + a VALID token → open/join that table's tab, set the cookie
 *  • not bound + no/invalid token → browse only (no tab created)
 */
export async function resolveMenuAccess(
  cookies: AstroCookies,
  urlToken: string | null,
): Promise<MenuAccess> {
  const session = await currentSession(cookies);

  // Recover the label from a signed token. A raw label (a legacy link, or the
  // "you're at Table X" / "order again" links, which carry the plain label)
  // verifies to null — that's fine: those only matter when a session already
  // exists, where we fall back to matching the raw value below.
  const tokenLabel = verifyTableToken(urlToken);

  if (session) {
    const target = tokenLabel ?? urlToken;
    if (!urlToken || session.table_label === target) {
      return { mode: "ok", table: session.table_label };
    }
    return { mode: "elsewhere", table: session.table_label };
  }

  // No session: a tab is opened ONLY for a validly-signed token. Guessed labels
  // recover nothing, so they can neither order onto a table nor spawn a tab.
  if (tokenLabel) {
    const tab: OpenTab | null = await openOrJoinTab(supabaseAdmin(), tokenLabel);
    if (tab) {
      setTabCookie(cookies, tab.token);
      return { mode: "ok", table: tab.table_label };
    }
  }

  return { mode: "ok", table: null }; // no valid token — browse only
}
