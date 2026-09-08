/**
 * POST /api/auth/logout — sign the staff member out. signOut() clears the
 * session cookies via the SSR client; we then redirect to the login page.
 */
import type { APIRoute } from "astro";
import { supabaseServer } from "../../../lib/supabase/server";
import { audit, actorOf } from "../../../lib/audit/log";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const supabase = supabaseServer(context);

  // Read who is leaving BEFORE the session is destroyed — afterwards there is
  // nobody to attribute it to. Note this records deliberate sign-outs only: a
  // session that is simply abandoned expires silently, and the honest answer
  // for those is the last action the person took, not a fabricated end time.
  const { profile } = context.locals;
  if (profile) {
    audit({
      action: "auth.signout",
      actor: actorOf(profile),
      summary: `${profile.name?.trim() || profile.role} signed out`,
      request: context.request,
    });
  }

  await supabase.auth.signOut();
  return context.redirect("/staff/login", 303);
};
