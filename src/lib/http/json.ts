/**
 * A JSON response.
 *
 * This was four byte-identical private copies — two order routes, the kitchen
 * availability route, and the endpoint guards in auth/session.ts. Small enough
 * that copying it never hurt, and exactly the kind of thing that drifts: the
 * day one of them needs a header or a different content type, the others
 * silently keep the old shape.
 *
 * Deliberately does not set cache-control. Callers say what their own
 * cacheability is, because the answer differs per route and a default here
 * would be wrong somewhere quietly — see api/menu/availability.ts, which is
 * shared-cacheable, against the staff polls, which must never be.
 */
export function json(data: unknown, status: number, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
