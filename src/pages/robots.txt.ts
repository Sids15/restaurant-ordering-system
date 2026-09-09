/**
 * GET /robots.txt — what a crawler may look at.
 *
 * The mirror of sitemap.xml.ts: the browse menu is open, everything else is
 * closed. The per-page `noindex` is what actually keeps these out of an index
 * (a Disallow only stops the fetch, and a URL can still be listed from links
 * elsewhere) — this is the first line, not the only one.
 *
 * /order/ is disallowed because an order code is a guest's own; /menu/ with a
 * segment is a signed per-table token, which is a credential, not a page.
 */
import type { APIRoute } from "astro";

export const prerender = false;

/**
 * `/menu/` with a segment matters most here. It is not merely a page a crawler
 * has no use for: resolveMenuAccess OPENS A TAB on first visit, so a fetch has
 * a side effect in the restaurant. `Allow: /menu$` above keeps the browse menu
 * itself open, which is the more specific rule for that one URL.
 */
const CLOSED = ["/staff", "/kitchen", "/admin", "/api/", "/order/", "/orders", "/menu/"];

export const GET: APIRoute = ({ site }) => {
  const origin = (site ?? new URL("http://localhost")).origin;
  const body = [
    "User-agent: *",
    "Allow: /menu$",
    ...CLOSED.map((p) => `Disallow: ${p}`),
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};
