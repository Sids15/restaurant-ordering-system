/**
 * Menu queries. Public menu reads use the anon key (guarded by RLS: anon only
 * sees available items). SERVER-ONLY — `anonClient` falls back to `process.env`,
 * which doesn't exist in the browser. Client islands never reach Supabase
 * directly; they poll our own `/api` routes instead.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MenuCategory, MenuItem } from "../types";
import { serverEnv } from "../env";

function anonClient(): SupabaseClient {
  return createClient(
    serverEnv(import.meta.env.SUPABASE_URL, "SUPABASE_URL"),
    serverEnv(import.meta.env.SUPABASE_ANON_KEY, "SUPABASE_ANON_KEY"),
    { auth: { persistSession: false } },
  );
}

export interface MenuCategoryWithItems extends MenuCategory {
  items: MenuItem[];
}

/**
 * Result of a menu load. `ok: false` means the menu could not be *reached*
 * (Supabase unreachable, misconfigured `.env`, RLS, outage) — which is a
 * different situation from a healthy-but-empty menu, and the UI must not
 * conflate the two. An empty `categories` on `ok: true` genuinely means "no
 * available items right now".
 */
export type MenuResult =
  | { ok: true; categories: MenuCategoryWithItems[] }
  | { ok: false; error: string };

/**
 * The full customer-facing menu: categories in order, each with its available
 * items. Empty categories are dropped.
 */
export async function getCustomerMenu(): Promise<MenuResult> {
  try {
    const supabase = anonClient();
    const [cats, items] = await Promise.all([
      supabase.from("menu_categories").select("*").order("sort_order"),
      supabase
        .from("menu_items")
        .select("*")
        .eq("is_available", true)
        .order("sort_order"),
    ]);

    // A failed call ≠ an empty menu. Surface it (server logs) rather than
    // silently returning [] and rendering the "menu is being set" empty state.
    if (cats.error || items.error) {
      console.error("[menu] getCustomerMenu failed:", cats.error ?? items.error);
      return { ok: false, error: "menu-unavailable" };
    }

    const categories = (cats.data ?? []) as MenuCategory[];
    const menuItems = (items.data ?? []) as MenuItem[];

    return {
      ok: true,
      categories: categories
        .map((c) => ({ ...c, items: menuItems.filter((i) => i.category_id === c.id) }))
        .filter((c) => c.items.length > 0),
    };
  } catch (err) {
    // e.g. a malformed URL makes createClient throw — still not a 500.
    console.error("[menu] getCustomerMenu threw:", err);
    return { ok: false, error: "menu-unavailable" };
  }
}

/** Ids of currently-available items — for the customer menu's live 86 poll. */
export async function getAvailableItemIds(): Promise<string[]> {
  const supabase = anonClient();
  const { data, error } = await supabase.from("menu_items").select("id").eq("is_available", true);
  if (error) return [];
  return (data ?? []).map((r) => r.id as string);
}

/** A flat list of all available items (for search/filter on the client). */
export async function getAvailableItems(): Promise<MenuItem[]> {
  const supabase = anonClient();
  const { data, error } = await supabase
    .from("menu_items")
    .select("*")
    .eq("is_available", true)
    .order("sort_order");
  if (error) {
    console.error("[menu] getAvailableItems failed:", error);
    return [];
  }
  return (data ?? []) as MenuItem[];
}
