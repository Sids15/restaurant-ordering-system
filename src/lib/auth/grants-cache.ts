/**
 * A short-lived, per-instance cache for the two RBAC lookups the middleware
 * would otherwise repeat on every single protected request.
 *
 * WHY: loading a staff page cost three sequential round trips before the page's
 * own queries began — the profile, then that role's grants, then (for a
 * manager) a count of owners. Measured against the live project that is ~105ms,
 * ~148ms for a manager, on every page load and every API call.
 *
 * The profile has to be read per request: it is per-user and it is what the
 * session resolves to. The other two do not. Grants are per-ROLE, so every
 * server on the floor shares one answer, and "does an owner exist" is a single
 * global fact. Both change rarely; both were being asked constantly.
 *
 * TTLs are deliberately short. This is a correctness/latency trade: a permission
 * an owner revokes takes up to GRANTS_TTL to apply everywhere, so the window is
 * kept to seconds rather than minutes. Even ten seconds removes nearly all of
 * the repeat queries, because staff load many pages a minute.
 *
 * Per-instance, like the rate limiter: each warm serverless instance keeps its
 * own copy and a cold start starts empty. That is fine — the worst case is the
 * query we were doing anyway.
 */

/** Long enough to collapse a burst of page loads, short enough that a
 *  permission change feels immediate to the owner who made it. */
const GRANTS_TTL_MS = 10_000;

/** "An owner exists" is effectively permanent once true — an owner is not
 *  demoted through the UI (setRole refuses to change your own role, and
 *  profiles is owner-writable only). Cached longer because of that. */
const OWNER_EXISTS_TTL_MS = 5 * 60_000;

/** "No owner yet" is a first-run state someone is actively trying to leave, so
 *  it expires quickly — the bootstrap banner must stop showing promptly once
 *  they have promoted themselves. */
const NO_OWNER_TTL_MS = 3_000;

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const grantsByRole = new Map<string, Entry<Set<string>>>();
let ownerExists: Entry<boolean> | null = null;

/** Cached grants for a role, or null when nothing fresh is held. */
export function cachedGrants(role: string): Set<string> | null {
  const hit = grantsByRole.get(role);
  if (!hit || hit.expiresAt <= Date.now()) return null;
  return hit.value;
}

export function cacheGrants(role: string, permissions: Set<string>): void {
  grantsByRole.set(role, { value: permissions, expiresAt: Date.now() + GRANTS_TTL_MS });
}

/** Cached "does an owner exist", or null when nothing fresh is held. */
export function cachedOwnerExists(): boolean | null {
  if (!ownerExists || ownerExists.expiresAt <= Date.now()) return null;
  return ownerExists.value;
}

export function cacheOwnerExists(value: boolean): void {
  ownerExists = {
    value,
    expiresAt: Date.now() + (value ? OWNER_EXISTS_TTL_MS : NO_OWNER_TTL_MS),
  };
}

/**
 * Drop everything, so the very next request re-reads.
 *
 * Called when an owner saves the permission matrix or changes someone's role,
 * which is what keeps an administrator's own edits feeling instant instead of
 * making them wait out the TTL. It only clears THIS instance — other warm
 * instances still expire on their own — so the TTL, not this, is what bounds
 * how stale a grant can be.
 */
export function invalidateGrants(): void {
  grantsByRole.clear();
  ownerExists = null;
}
