/**
 * Running a select whose newest columns may not exist yet.
 *
 * Migrations are applied by hand in the Supabase SQL editor, so there is always
 * a window where the deployed code is ahead of the database. PostgREST rejects
 * the whole query when it names a column or relationship it doesn't know, and
 * every caller in this app treats a query error as "no rows" — which turns a
 * missing OPTIONAL feature into an empty screen. The open-tabs list is the
 * surface servers bill from; the manager's day view reports the day's takings.
 * Neither should blank out because a migration is pending.
 *
 * So: run the query with the new columns, and if it errors, run it again
 * without them. The retry stops firing by itself once the migration lands.
 */
export async function selectOptional<T>(
  run: (withOptionalColumns: boolean) => PromiseLike<{ data: T | null; error: unknown }>,
  hint: string,
): Promise<{ data: T | null; error: unknown }> {
  const first = await run(true);
  if (!first.error) return first;
  console.warn(`[db] falling back without optional columns — apply ${hint}`);
  return run(false);
}
