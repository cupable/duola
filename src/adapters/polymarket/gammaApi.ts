import { fetchJson } from "./http.js";

export interface GammaMarket {
  conditionId: string;
  question: string;
  slug: string;
  category?: string;
  endDate?: string;
  active: boolean;
  closed: boolean;
  liquidityNum?: number;
  orderPriceMinTickSize?: number;
  negRisk?: boolean;
  bestBid?: number;
  bestAsk?: number;
  spread?: number;
  clobTokenIds?: string;
  events?: Array<{
    slug?: string;
    series?: {
      slug?: string;
      title?: string;
    };
  }>;
}

const baseUrl = "https://gamma-api.polymarket.com";

export async function fetchMarketsByConditionIds(conditionIds: string[]): Promise<GammaMarket[]> {
  if (conditionIds.length === 0) {
    return [];
  }

  const url = new URL("/markets", baseUrl);
  url.searchParams.set("condition_ids", conditionIds.join(","));
  return fetchJson<GammaMarket[]>(url.toString());
}
