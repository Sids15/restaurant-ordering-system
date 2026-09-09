/**
 * GET /sitemap.xml — the one public URL this app has.
 *
 * Deliberately not the whole route table. Everything else is either per-guest
 * (order codes, per-table QR links) or staff-only, and a sitemap is a request
 * to index: advertising an order code to a crawler would publish someone's
 * order. The browse menu is the single page a restaurant actually wants found,
 * and it is the only page that does not send `noindex`.
 *
 * See robots.txt.ts, which closes the same doors from the other side.
 */
import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = ({ site }) => {
  const origin = (site ?? new URL("http://localhost")).origin;
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}/menu</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};
