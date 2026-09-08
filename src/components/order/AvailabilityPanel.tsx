/**
 * AvailabilityPanel — the 86 / sold-out toggle, a section under the kitchen
 * board. Kitchen + manager flip a dish available or sold out; the change hides
 * it from the customer menu. Optimistic on tap, reverting if the write fails,
 * and polls every few seconds so a second station's changes show up.
 *
 * Initial state comes from props (deterministic), so SSR and hydration match.
 */
import { useMemo, useState } from "react";
import { usePoll } from "./use-poll";
import "./availability-panel.css";

interface Item {
  id: string;
  name: string;
  is_available: boolean;
}
interface Category {
  id: string;
  name: string;
  items: Item[];
}

const POLL_MS = 8000;

export default function AvailabilityPanel({
  initialMenu,
}: {
  initialMenu: Category[];
}) {
  const [menu, setMenu] = useState<Category[]>(initialMenu);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [offOnly, setOffOnly] = useState(false);

  usePoll(
    async () => {
      const res = await fetch("/api/staff/kitchen/menu", { cache: "no-store" });
      if (!res.ok) throw new Error(`availability: ${res.status}`);
      const data = (await res.json()) as { menu?: Category[] };
      // Don't clobber a row mid-toggle. usePoll re-reads this closure every
      // render, so `busy` here is current rather than captured once.
      if (Array.isArray(data.menu) && busy.size === 0) setMenu(data.menu);
    },
    POLL_MS,
    { immediate: false }, // the panel is server-rendered with the live menu
  );

  function setItem(id: string, is_available: boolean) {
    setMenu((prev) =>
      prev.map((c) => ({
        ...c,
        items: c.items.map((i) => (i.id === id ? { ...i, is_available } : i)),
      })),
    );
  }

  async function toggle(id: string, current: boolean) {
    const next = !current;
    setBusy((s) => new Set(s).add(id));
    setItem(id, next); // optimistic
    try {
      const res = await fetch("/api/staff/kitchen/availability", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: id, available: next }),
      });
      if (!res.ok) setItem(id, current); // revert on failure
    } catch {
      setItem(id, current);
    } finally {
      setBusy((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  // What is currently off, across every category. A cook wants this as one
  // short list — hunting for the red rows inside a full menu is the problem.
  const offCount = useMemo(
    () => menu.reduce((n, c) => n + c.items.filter((i) => !i.is_available).length, 0),
    [menu],
  );

  // Empty categories are dropped when filtering, so the list is the answer
  // rather than a page of headings with nothing under them.
  const shown = useMemo(() => {
    if (!offOnly) return menu;
    return menu
      .map((c) => ({ ...c, items: c.items.filter((i) => !i.is_available) }))
      .filter((c) => c.items.length > 0);
  }, [menu, offOnly]);

  return (
    <section className="avail" aria-label="Dish availability">
      <header className="avail__head">
        <h2 className="avail__title">Availability · 86</h2>
        <button
          type="button"
          className="avail__filter"
          aria-pressed={offOnly}
          onClick={() => setOffOnly((v) => !v)}
          disabled={offCount === 0 && !offOnly}
        >
          {offCount === 0 ? "Nothing 86'd" : offOnly ? "Show all dishes" : "Show 86'd only"}
          {offCount > 0 && <span className="avail__filter-n">{offCount}</span>}
        </button>
      </header>
      <div className="avail__cats">
        {shown.map((c) => (
          <div key={c.id} className="avail__cat">
            <h3 className="avail__catname h-label">{c.name}</h3>
            <ul className="avail__list">
              {c.items.map((it) => (
                <li key={it.id} className={`arow ${it.is_available ? "" : "arow--off"}`}>
                  <span className="arow__name">{it.name}</span>
                  <button
                    type="button"
                    className={`arow__toggle ${it.is_available ? "is-on" : "is-off"}`}
                    onClick={() => toggle(it.id, it.is_available)}
                    disabled={busy.has(it.id)}
                    aria-pressed={!it.is_available}
                  >
                    {it.is_available ? "Available" : "86'd"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
