// Pure helper for reading an order's per-product line items — split out
// because every order created before multi-product support shipped has
// zero OrderItem rows, and every reader (order-detail breakdowns) needs to
// treat that the same way: as one implicit PORK line synthesized from the
// legacy flat fields, rather than each caller re-deriving that fallback.

import { DEFAULT_PRODUCT_TYPE } from "./rackCode";

export interface OrderItemLike {
  productType: string;
  weight: number;
  pieceCount: number | null;
  price: number;
}

export interface OrderForItems {
  items?: OrderItemLike[] | null;
  crispyPorkWeight?: string | null;
  crispyPorkPiece?: string | null;
  price?: number | null;
}

export function getEffectiveItems(order: OrderForItems): OrderItemLike[] {
  if (order.items && order.items.length > 0) return order.items;

  const weight = parseFloat(order.crispyPorkWeight || "");
  if (isNaN(weight) || weight <= 0) return [];

  const pieceCount = order.crispyPorkPiece ? parseInt(order.crispyPorkPiece, 10) : null;
  return [
    {
      productType: DEFAULT_PRODUCT_TYPE,
      weight,
      pieceCount: pieceCount !== null && !isNaN(pieceCount) ? pieceCount : null,
      price: order.price ?? 0,
    },
  ];
}

export function sumItemsWeight(items: OrderItemLike[]): number {
  return items.reduce((sum, it) => sum + (Number(it.weight) || 0), 0);
}

export function sumItemsPieceCount(items: OrderItemLike[]): number | null {
  if (items.length === 0) return null;
  const total = items.reduce((sum, it) => sum + (it.pieceCount || 0), 0);
  return total;
}

export function sumItemsPrice(items: OrderItemLike[]): number {
  return items.reduce((sum, it) => sum + (Number(it.price) || 0), 0);
}
