import { fetchJson } from "./http.js";

export interface ActivityItem {
  proxyWallet: string;
  timestamp: number;
  conditionId: string;
  type: string;
  size: number;
  usdcSize?: number;
  transactionHash: string;
  price?: number;
  asset?: string;
  side?: string;
  outcome?: string;
  slug?: string;
  title?: string;
}

const baseUrl = "https://data-api.polymarket.com";

export async function fetchActivity(user: string, limit: number, offset: number): Promise<ActivityItem[]> {
  const url = new URL("/activity", baseUrl);
  url.searchParams.set("user", user);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  return fetchJson<ActivityItem[]>(url.toString());
}
