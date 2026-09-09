/**
 * GET /api/menu/availability — ids of currently-available dishes. Public (anon,
 * RLS-guarded). The customer menu island polls this so a dish 86'd in the
 * kitchen disappears from the menu live, without a reload.
 */
import type { APIRoute } from "astro";
import { getAvailableItemIds } from "../../../lib/menu/queries";

export const prerender = false;

/**
 * How long the edge may hold one answer.
 *
 * Every guest phone asks this every five seconds, so twenty tables is four
 * requests a second — each one waking a function and running the same query for
 * the same byte-identical answer. That is what put p95 at 1.6s under a full
 * floor. Three seconds of sharing turns those four requests a second into one
 * every three, and the rest are served from Mumbai without touching the
 * database.
 *
 * Three, not thirty, because the menu changes mid-service: the worst a guest
 * sees is the poll interval plus this, so a sold-out dish leaves the screen
 * within about eight seconds. That is cosmetic in every case — createOrder
 * re-reads availability and refuses a sold-out dish with "just sold out",
 * however stale the menu looked when they tapped. The kitchen's own panel does
 * not read this endpoint at all, so an 86 is still instant for the person
 * doing it.
 *
 * `max-age=0` keeps the phone from sitting on its own copy past the window;
 * `stale-while-revalidate` means the one poll that lands on expiry is served
 * immediately and the refresh happens behind it, so no guest waits for it.
 */
const EDGE_SECONDS = 3;
const STALE_SECONDS = 10;

export const GET: APIRoute = async () => {
  const ids = await getAvailableItemIds();
  return new Response(JSON.stringify({ ids }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=0, s-maxage=${EDGE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
    },
  });
};
