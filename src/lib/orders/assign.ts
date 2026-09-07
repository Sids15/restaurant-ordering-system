/**
 * Assigning a server to a table.
 *
 * The assignment lives on the tab — one sitting — so it arrives when the table
 * is seated and retires with the bill. It is entirely optional: an unassigned
 * tab orders, prints and bills exactly as it always did. Nothing here gates
 * anything; it only answers "whose table is this?".
 *
 * Managers count as assignable because on a small floor the manager works
 * tables too. Kitchen accounts never do.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "../types";

/** A staff member who can be put on a table. */
export interface Assignee {
  id: string;
  name: string;
  role: Role;
}

/** The roles that wait tables. Kitchen is deliberately absent. */
const FLOOR_ROLES: Role[] = ["server", "manager"];

/**
 * A display name for a profile row. `profiles.name` defaults to '' (the seed
 * accounts never filled it in), so fall back to the role rather than render an
 * empty chip.
 */
export function assigneeName(a: Pick<Assignee, "name" | "role"> | null): string {
  if (!a) return "";
  const n = (a.name ?? "").trim();
  return n || a.role;
}

/**
 * Everyone who can be put on a table, for the picker. Readable by any staff
 * account since 008_tab_assignment.sql; before that only a manager could see
 * other people's profiles.
 */
export async function listAssignable(supabase: SupabaseClient): Promise<Assignee[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, role")
    .in("role", FLOOR_ROLES)
    .order("name", { ascending: true });

  if (error || !data) return [];
  return data.map((p) => ({
    id: p.id as string,
    name: (p.name as string) ?? "",
    role: p.role as Role,
  }));
}

/**
 * Put `userId` on the tab, or clear it with null. Only open tabs — a closed
 * tab's assignment is history and shouldn't be rewritten after the fact.
 */
export async function assignTab(
  supabase: SupabaseClient,
  tabId: string,
  userId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { data: tab } = await supabase
    .from("tabs")
    .select("id, status")
    .eq("id", tabId)
    .maybeSingle();
  if (!tab) return { ok: false, error: "Tab not found." };
  if (tab.status !== "open") return { ok: false, error: "That tab is closed." };

  // Verify the target is someone who actually waits tables, so a stray id (or
  // a kitchen account) can't end up owning a table.
  if (userId) {
    const { data: who } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", userId)
      .maybeSingle();
    if (!who || !FLOOR_ROLES.includes(who.role as Role)) {
      return { ok: false, error: "That person can't be put on a table." };
    }
  }

  const { error } = await supabase
    .from("tabs")
    .update({ assigned_to: userId })
    .eq("id", tabId)
    .eq("status", "open");

  if (error) return { ok: false, error: "Couldn't update the table — please retry." };
  return { ok: true };
}

/**
 * Take the table only if nobody has it. Used when a server builds a round for a
 * table: whoever takes the first order owns it by default, and a manager can
 * reassign afterwards. Silent — an already-assigned tab is left alone, and a
 * failure here must never fail the order.
 */
export async function claimTabIfUnassigned(
  supabase: SupabaseClient,
  tabId: string,
  userId: string,
): Promise<void> {
  try {
    await supabase
      .from("tabs")
      .update({ assigned_to: userId })
      .eq("id", tabId)
      .eq("status", "open")
      .is("assigned_to", null);
  } catch {
    // An unassigned tab is a cosmetic loss; the order itself already landed.
  }
}

// --- Reading the assignment back ---------------------------------------------

/**
 * The embedded profile behind `tabs.assigned_to`, for a PostgREST select.
 * Disambiguated by constraint name: tabs references profiles twice
 * (assigned_to and closed_by), so the relationship must be named.
 */
export const ASSIGNED_EMBED = "assigned:profiles!tabs_assigned_to_fkey ( id, name, role )";

/**
 * Run a tab select that embeds the assignment, falling back to the same query
 * without it when the column isn't there yet.
 *
 * Without this, pushing the code before applying 008_tab_assignment.sql makes
 * PostgREST reject the embed, and every caller's `if (error) return []` turns a
 * missing OPTIONAL feature into a blank open-tabs list — the surface servers
 * bill from. The retry keeps the old behaviour until the migration lands, then
 * stops firing on its own.
 */
export async function selectTabs<T>(
  run: (withAssignment: boolean) => PromiseLike<{ data: T | null; error: unknown }>,
): Promise<{ data: T | null; error: unknown }> {
  const first = await run(true);
  if (!first.error) return first;
  console.warn(
    "[tabs] assignment unavailable — apply supabase/migrations/008_tab_assignment.sql",
  );
  return run(false);
}
