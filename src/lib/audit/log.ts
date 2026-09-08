/**
 * Writing the audit trail.
 *
 * Two rules govern everything here.
 *
 * LOGGING MUST NEVER BREAK THE THING IT LOGS. A failed write to the audit table
 * cannot be allowed to fail a cancellation, a sign-in, or a closed tab. Every
 * write is fire-and-forget and every error is swallowed to the console — a
 * missing log line is a bad day, a refused sign-in mid-service is a worse one.
 *
 * THE ACTOR IS SNAPSHOTTED. The name and role are copied in as they were at the
 * time, because that is the fact worth keeping: "manager Priya voided ₹1,560"
 * stays true after Priya is renamed, demoted, or removed.
 *
 * Writes use the service-role client on purpose. The audit table has NO RLS
 * policies at all (014), so no signed-in user can read it, add to it, or erase
 * it through the app: nobody can forge an entry attributed to a colleague, and
 * nobody can quietly remove their own.
 *
 * Every entry is ALSO written to the server log, and that line goes out first.
 * It is the copy that survives a database outage, and the one the hosting
 * platform collects — this trail is read from the server, never from a page.
 */
import { supabaseAdmin } from "../supabase/admin";
import type { Role } from "../types";

/**
 * The vocabulary. Dotted verbs so the viewer can group and filter on a prefix,
 * and so a new action reads consistently with the old ones.
 */
export type AuditAction =
  // Sessions
  | "auth.signin"
  | "auth.signin.failed"
  | "auth.signout"
  // Orders
  | "order.create"
  | "order.confirm"
  | "order.void"
  | "order.ready"
  // Tabs and money
  | "tab.close"
  | "tab.move"
  | "tab.merge"
  | "tab.assign"
  // Menu
  | "menu.item.create"
  | "menu.item.update"
  | "menu.item.delete"
  | "menu.category.create"
  | "menu.category.update"
  | "menu.category.delete"
  | "menu.availability"
  // Administration
  | "access.permissions"
  | "access.role"
  | "tables.generate";

export interface Actor {
  id: string | null;
  name: string;
  role: Role | string;
}

export interface AuditEntry {
  action: AuditAction;
  actor: Actor;
  /** What it was done to, in the app's terms: "order" / "tab" / "menu_item". */
  subjectType?: string;
  subjectId?: string;
  /** One human sentence for the viewer. Written at the call site, where the
   *  context actually is. */
  summary: string;
  detail?: Record<string, unknown>;
  /** The request, so the IP can be recorded. Optional. */
  request?: Request;
}

/**
 * Record one event.
 *
 * Deliberately returns void rather than a result: no caller should be branching
 * on whether the log wrote, because no caller should change what it does when
 * it didn't.
 */
export function audit(entry: AuditEntry): void {
  // Emitted first, and synchronously: if the database is unreachable this line
  // is the record. One greppable line, no secrets in it.
  const who = entry.actor.name || "anon";
  const role = entry.actor.role ? `(${entry.actor.role})` : "";
  const subject = entry.subjectId ? ` subject=${entry.subjectId}` : "";
  console.info(`[audit] ${entry.action} actor=${who}${role}${subject} — ${entry.summary}`);

  void write(entry).catch((err) => {
    console.error("[audit] db write failed:", entry.action, err);
  });
}

async function write(entry: AuditEntry): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("audit_log")
    .insert({
      actor_id: entry.actor.id,
      // Snapshotted, not joined — see the note at the top.
      actor_name: (entry.actor.name ?? "").trim() || String(entry.actor.role ?? ""),
      actor_role: String(entry.actor.role ?? ""),
      action: entry.action,
      subject_type: entry.subjectType ?? null,
      subject_id: entry.subjectId ?? null,
      summary: entry.summary,
      detail: entry.detail ?? {},
      ip: entry.request ? clientIpOf(entry.request) : null,
    });

  if (error) {
    // The table may not exist yet — migrations are applied by hand. Say which
    // one, once, rather than filling the log with noise.
    if (isMissingTable(error)) {
      warnOnce("[audit] no audit_log table — apply supabase/migrations/014_audit_log.sql");
      return;
    }
    throw error;
  }
}

function isMissingTable(error: { code?: string; message?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return text.includes("42p01") || text.includes("pgrst205") || text.includes("does not exist");
}

let warned = false;
function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  console.warn(message);
}

/**
 * Platform-set headers first, exactly as the rate limiter does: a caller can
 * send their own x-forwarded-for, and an audit trail recording an attacker's
 * chosen address is worse than one recording none.
 */
function clientIpOf(request: Request): string | null {
  const shaped = /^[0-9a-fA-F.:]{3,45}$/;
  for (const header of ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"]) {
    const first = request.headers.get(header)?.split(",")[0]?.trim();
    if (first && shaped.test(first)) return first;
  }
  return null;
}

/** The actor for a signed-in staff member. */
export function actorOf(profile: { id: string; name: string; role: Role }): Actor {
  return { id: profile.id, name: profile.name, role: profile.role };
}

/** The actor for someone who isn't signed in — a failed sign-in, or a guest. */
export function anonActor(label: string): Actor {
  return { id: null, name: label, role: "" };
}
