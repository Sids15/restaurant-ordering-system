/**
 * Shared domain types for the ordering app. These mirror the Postgres schema
 * (see supabase/migrations). Kept framework-agnostic so both server and client
 * code can import them.
 */

export type Role = "manager" | "kitchen" | "server";
export type VegType = "veg" | "non_veg" | "egg";
export type OrderSource = "customer" | "server";
export type TabStatus = "open" | "closed" | "merged";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "served"
  | "cancelled";

/** Order-status transitions the UI/API are allowed to make.
 *
 * `preparing` is retired: the kitchen advances confirmed → ready in one tap. It
 * stays in the enum (Postgres can't drop a value without recreating the type)
 * and keeps its outgoing transitions so a ticket already in that status when
 * this shipped can still be completed. Nothing moves INTO it any more. */
export const ORDER_FLOW: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["ready", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["served"],
  served: [],
  cancelled: [],
};

export interface MenuCategory {
  id: string;
  name: string;
  sort_order: number;
}

export interface MenuItem {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: number;
  veg_type: VegType;
  tags: string[];
  image_url: string | null;
  is_available: boolean;
  is_signature: boolean;
  sort_order: number;
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  name_snapshot: string;
  price_snapshot: number;
  qty: number;
  notes: string | null;
}

export interface Order {
  id: string;
  code: string;
  table_label: string | null;
  status: OrderStatus;
  source: OrderSource;
  subtotal: number;
  notes: string | null;
  tab_id: string | null;
  created_at: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
}

/** A table session: the rounds a table orders across one visit, billed together. */
export interface Tab {
  id: string;
  table_label: string;
  status: TabStatus;
  opened_at: string;
  closed_at: string | null;
  closed_by: string | null;
}

/** An order with its line items joined in (as the panels consume it). */
export interface OrderWithItems extends Order {
  order_items: OrderItem[];
}

/** A cart line held client-side before an order is placed. */
export interface CartLine {
  item: MenuItem;
  qty: number;
  notes?: string;
}
