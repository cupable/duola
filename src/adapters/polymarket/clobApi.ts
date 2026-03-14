import { fetchJson } from "./http.js";

export interface MidpointResponse {
  mid: string;
}

export interface PriceResponse {
  price: string;
}

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface OrderBookResponse {
  asset_id: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: string;
  last_trade_price?: string;
}

export interface PriceHistoryPoint {
  t: number;
  p: number;
}

export interface PriceHistoryResponse {
  history: PriceHistoryPoint[];
}

const baseUrl = "https://clob.polymarket.com";

export async function fetchMidpoint(assetId: string): Promise<number | null> {
  const url = new URL("/midpoint", baseUrl);
  url.searchParams.set("token_id", assetId);
  const response = await fetchJson<MidpointResponse>(url.toString());
  const value = Number(response.mid);
  return Number.isFinite(value) ? value : null;
}

export async function fetchPrice(assetId: string, side: "buy" | "sell"): Promise<number | null> {
  const url = new URL("/price", baseUrl);
  url.searchParams.set("token_id", assetId);
  url.searchParams.set("side", side);
  const response = await fetchJson<PriceResponse>(url.toString());
  const value = Number(response.price);
  return Number.isFinite(value) ? value : null;
}

export async function fetchBook(assetId: string): Promise<OrderBookResponse> {
  const url = new URL("/book", baseUrl);
  url.searchParams.set("token_id", assetId);
  return fetchJson<OrderBookResponse>(url.toString());
}

export async function fetchPriceHistory(assetId: string, interval = "1d", fidelity = 1440): Promise<PriceHistoryPoint[]> {
  const url = new URL("/prices-history", baseUrl);
  url.searchParams.set("market", assetId);
  url.searchParams.set("interval", interval);
  url.searchParams.set("fidelity", String(fidelity));
  const response = await fetchJson<PriceHistoryResponse>(url.toString());
  return response.history ?? [];
}
