/**
 * GET /favicon.svg — the browser tab mark.
 *
 * Generated rather than checked in, for the same reason nothing else in this
 * app hard-codes the restaurant: the mark is drawn from brand.accent and the
 * first letter of brand.name, so re-skinning for another restaurant stays a
 * one-file edit instead of a trip through an image editor.
 *
 * Without any icon at all the browser asks for /favicon.ico on every page load
 * and takes a 404 — the only error the console had.
 */
import type { APIRoute } from "astro";
import { brand } from "../data/brand";

/** First letter of the restaurant's name, for the mark. */
const initial = (brand.name.trim()[0] ?? "R").toUpperCase();

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${brand.name}">
  <title>${brand.name}</title>
  <rect width="64" height="64" rx="14" fill="${brand.accent}"/>
  <text x="32" y="33" fill="#ffffff" font-family="Georgia, 'Times New Roman', serif"
        font-size="38" font-weight="600" text-anchor="middle" dominant-baseline="central">${initial}</text>
</svg>`;

export const prerender = false;

export const GET: APIRoute = () =>
  new Response(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // The mark only changes when the brand does, which is a redeploy.
      "cache-control": "public, max-age=86400",
    },
  });
