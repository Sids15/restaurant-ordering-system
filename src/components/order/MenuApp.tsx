/**
 * MenuApp — the customer ordering island.
 *
 * Server-rendered menu data comes in as props; everything interactive lives
 * here: dietary filter, search, category jump-nav, and the cart (a sticky bar
 * that expands into a bottom-sheet to review + place the order). The cart
 * persists to localStorage keyed by table, so a refresh mid-browse keeps it.
 *
 * Placing an order POSTs to /api/orders and navigates to /order/<code>.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { VegType } from "../../lib/types";
import { formatINR } from "../../lib/money";
import { brand } from "../../data/brand";
import "./menu-app.css";

interface MenuItemData {
  id: string;
  name: string;
  description: string | null;
  price: number;
  veg_type: VegType;
  tags: string[];
  is_signature: boolean;
}
interface CategoryData {
  id: string;
  name: string;
  items: MenuItemData[];
}
interface Props {
  categories: CategoryData[];
  table: string | null;
}

/** Cart is a flat map of item id → { qty, notes }. */
type Cart = Record<string, { qty: number; notes: string }>;

const VEG_FILTERS: { key: VegType; label: string }[] = [
  { key: "veg", label: "Veg" },
  { key: "non_veg", label: "Non-veg" },
  { key: "egg", label: "Egg" },
];

const storageKey = (table: string | null) => `cart.${table ?? "na"}`;

export default function MenuApp({ categories, table }: Props) {
  const allItems = useMemo(
    () => Object.fromEntries(categories.flatMap((c) => c.items).map((i) => [i.id, i])),
    [categories],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [veg, setVeg] = useState<Set<VegType>>(new Set());
  const [cart, setCart] = useState<Cart>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Availability, kept live: a dish 86'd in the kitchen drops off the menu.
  // Starts as every item (matches SSR), then the poll narrows it.
  const [availableIds, setAvailableIds] = useState<Set<string>>(
    () => new Set(Object.keys(allItems)),
  );
  const hydrated = useRef(false);

  // Keep availability live so a dish 86'd in the kitchen drops off fast. Anon
  // can't receive Realtime events under RLS (verified), so we poll — quickly,
  // on mount, and the instant the tab regains focus (the common "flip from the
  // kitchen tab" case).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/menu/availability", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { ids?: string[] };
        if (alive && Array.isArray(data.ids)) setAvailableIds(new Set(data.ids));
      } catch {
        /* transient — next tick retries */
      }
    };
    tick(); // fresh on load
    const id = setInterval(tick, 2000);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  // Load a saved cart once, on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(table));
      if (raw) {
        const saved = JSON.parse(raw) as Cart;
        // Drop items that have since left the menu.
        const pruned: Cart = {};
        for (const [id, line] of Object.entries(saved)) {
          if (allItems[id] && line.qty > 0) pruned[id] = line;
        }
        setCart(pruned);
      }
    } catch {
      /* ignore corrupt storage */
    }
    hydrated.current = true;
  }, [table, allItems]);

  // Persist the cart after hydration.
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(storageKey(table), JSON.stringify(cart));
    } catch {
      /* storage may be unavailable (private mode) — cart just won't persist */
    }
  }, [cart, table]);

  const setQty = (id: string, qty: number) =>
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[id];
      else next[id] = { qty, notes: c[id]?.notes ?? "" };
      return next;
    });
  const inc = (id: string) => setQty(id, (cart[id]?.qty ?? 0) + 1);
  const dec = (id: string) => setQty(id, (cart[id]?.qty ?? 0) - 1);
  const setNote = (id: string, notes: string) =>
    setCart((c) => (c[id] ? { ...c, [id]: { ...c[id], notes } } : c));

  const count = useMemo(
    () => Object.values(cart).reduce((n, l) => n + l.qty, 0),
    [cart],
  );
  const subtotal = useMemo(
    () =>
      Object.entries(cart).reduce(
        (sum, [id, l]) => sum + (allItems[id]?.price ?? 0) * l.qty,
        0,
      ),
    [cart, allItems],
  );

  // Filter: dietary chips (empty = all) + free-text over name/description/tags.
  const q = query.trim().toLowerCase();
  const visibleCategories = useMemo(() => {
    return categories
      .map((c) => ({
        ...c,
        items: c.items.filter((i) => {
          if (!availableIds.has(i.id)) return false; // 86'd — hide it live
          if (veg.size && !veg.has(i.veg_type)) return false;
          if (!q) return true;
          const hay = `${i.name} ${i.description ?? ""} ${i.tags.join(" ")}`.toLowerCase();
          return hay.includes(q);
        }),
      }))
      .filter((c) => c.items.length > 0);
  }, [categories, veg, q, availableIds]);

  // Lightweight fade-in as sections rise into view — purely decorative, not
  // tied to scroll position or any color state.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = Array.from(
      root.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-revealed)"),
    );
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) {
      els.forEach((e) => e.classList.add("is-revealed"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-revealed");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [visibleCategories]);

  const toggleVeg = (key: VegType) =>
    setVeg((s) => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const jumpTo = (id: string) => {
    document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  async function placeOrder() {
    setPlacing(true);
    setError(null);
    try {
      const lines = Object.entries(cart).map(([item_id, l]) => ({
        item_id,
        qty: l.qty,
        notes: l.notes || null,
      }));
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ table_label: table, lines }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Couldn't place your order.");
      // Success — clear the cart and hand off to the tracking page.
      try {
        localStorage.removeItem(storageKey(table));
      } catch {
        /* ignore */
      }
      window.location.href = `/order/${data.code}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPlacing(false);
    }
  }

  const noResults = visibleCategories.length === 0;

  return (
    <div className="menu" data-sheet={sheetOpen ? "open" : "closed"} ref={rootRef}>
      <header className="menu__header" data-reveal>
        <p className="menu__eyebrow">{brand.name}</p>
        <h1 className="menu__title">Menu</h1>
        {brand.tagline && <p className="menu__tagline">{brand.tagline}</p>}
        <div className="menu__meta">
          <span className="menu__hours">{brand.contact.hours}</span>
          {table && <span className="menu__table">Table {table}</span>}
        </div>
      </header>

      <div className="menu__controls">
        <label className="menu__search">
          <span className="visually-hidden">Search the menu</span>
          <input
            type="search"
            inputMode="search"
            placeholder="Search dishes, tags…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="menu__filters" role="group" aria-label="Dietary filter">
          {VEG_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="chip"
              aria-pressed={veg.has(f.key)}
              onClick={() => toggleVeg(f.key)}
            >
              <VegDot type={f.key} />
              {f.label}
            </button>
          ))}
        </div>
        {!q && (
          <nav className="menu__jump" aria-label="Jump to course">
            {categories.map((c) => (
              <button key={c.id} type="button" className="jump" onClick={() => jumpTo(c.id)}>
                {c.name}
              </button>
            ))}
          </nav>
        )}
      </div>

      {noResults ? (
        <p className="menu__empty">No dishes match that. Try clearing the filters.</p>
      ) : (
        <div className="menu__sections">
          {visibleCategories.map((c) => (
            <section key={c.id} id={`cat-${c.id}`} className="course">
              <h2 className="course__name" data-reveal>
                {c.name}
              </h2>
              <ul className="course__list">
                {c.items.map((item) => (
                  <MenuRow
                    key={item.id}
                    item={item}
                    qty={cart[item.id]?.qty ?? 0}
                    onAdd={() => inc(item.id)}
                    onInc={() => inc(item.id)}
                    onDec={() => dec(item.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {count > 0 && (
        <button
          type="button"
          className="cartbar"
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
        >
          {/* keyed so it re-mounts and replays the bump each time the count changes */}
          <span key={count} className="cartbar__count">
            {count}
          </span>
          <span className="cartbar__label">View order</span>
          <span className="cartbar__total">{formatINR(subtotal)}</span>
        </button>
      )}

      {sheetOpen && (
        <CartSheet
          cart={cart}
          items={allItems}
          subtotal={subtotal}
          placing={placing}
          error={error}
          onClose={() => setSheetOpen(false)}
          onInc={inc}
          onDec={dec}
          onNote={setNote}
          onPlace={placeOrder}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ menu row */

function MenuRow({
  item,
  qty,
  onAdd,
  onInc,
  onDec,
}: {
  item: MenuItemData;
  qty: number;
  onAdd: () => void;
  onInc: () => void;
  onDec: () => void;
}) {
  return (
    <li className={item.is_signature ? "dish dish--sig" : "dish"} data-reveal>
      <div className="dish__body">
        <div className="dish__line">
          <span className="dish__title">
            <VegDot type={item.veg_type} />
            {item.name}
            {item.is_signature && (
              <span className="dish__sig" aria-hidden="true">
                ★
              </span>
            )}
          </span>
          <span className="dish__price">{formatINR(item.price)}</span>
        </div>
        {item.description && <p className="dish__desc">{item.description}</p>}
        {(item.is_signature || item.tags.length > 0) && (
          <div className="dish__meta">
            {item.is_signature && <span className="dish__signword">Signature</span>}
            {item.tags.map((t) => (
              <span key={t} className="tag">
                {t.replace(/-/g, " ")}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="dish__add">
        {qty === 0 ? (
          <button type="button" className="add" onClick={onAdd}>
            Add
          </button>
        ) : (
          <Stepper qty={qty} onInc={onInc} onDec={onDec} />
        )}
      </div>
    </li>
  );
}

function Stepper({ qty, onInc, onDec }: { qty: number; onInc: () => void; onDec: () => void }) {
  return (
    <div className="stepper" role="group" aria-label="Quantity">
      <button type="button" className="stepper__btn" onClick={onDec} aria-label="Remove one">
        −
      </button>
      <span className="stepper__qty" aria-live="polite">
        {qty}
      </span>
      <button type="button" className="stepper__btn" onClick={onInc} aria-label="Add one">
        +
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- cart sheet */

function CartSheet({
  cart,
  items,
  subtotal,
  placing,
  error,
  onClose,
  onInc,
  onDec,
  onNote,
  onPlace,
}: {
  cart: Cart;
  items: Record<string, MenuItemData>;
  subtotal: number;
  placing: boolean;
  error: string | null;
  onClose: () => void;
  onInc: (id: string) => void;
  onDec: (id: string) => void;
  onNote: (id: string, notes: string) => void;
  onPlace: () => void;
}) {
  const lines = Object.entries(cart).filter(([id]) => items[id]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Your order">
      <button type="button" className="sheet__scrim" aria-label="Close order" onClick={onClose} />
      <div className="sheet__panel">
        <div className="sheet__grabber" />
        <div className="sheet__head">
          <h2 className="sheet__title">Your order</h2>
          <button type="button" className="sheet__close" onClick={onClose}>
            Close
          </button>
        </div>

        <ul className="sheet__list">
          {lines.map(([id, line]) => {
            const item = items[id];
            return (
              <li key={id} className="line">
                <div className="line__top">
                  <VegDot type={item.veg_type} />
                  <span className="line__name">{item.name}</span>
                  <span className="line__price">{formatINR(item.price * line.qty)}</span>
                </div>
                <div className="line__controls">
                  <Stepper qty={line.qty} onInc={() => onInc(id)} onDec={() => onDec(id)} />
                  <input
                    className="line__note"
                    type="text"
                    placeholder="Add a note (optional)"
                    value={line.notes}
                    onChange={(e) => onNote(id, e.target.value)}
                    maxLength={200}
                  />
                </div>
              </li>
            );
          })}
        </ul>

        <div className="sheet__foot">
          <div className="sheet__total">
            <span>Subtotal</span>
            <span>{formatINR(subtotal)}</span>
          </div>
          <p className="sheet__fineprint">
            Taxes &amp; charges applied on the final bill. Show your code to a server to confirm.
          </p>
          {error && <p className="sheet__error">{error}</p>}
          <button type="button" className="place" onClick={onPlace} disabled={placing}>
            {placing ? "Placing…" : "Place order"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- veg marker */

function VegDot({ type }: { type: VegType }) {
  const label = type === "veg" ? "Vegetarian" : type === "non_veg" ? "Non-vegetarian" : "Contains egg";
  return <span className={`vegdot vegdot--${type}`} role="img" aria-label={label} />;
}
