import { type ActivityItem } from "../adapters/polymarket/dataApi.js";
import { sha256 } from "../utils/hash.js";

export function buildSourceUid(item: ActivityItem): string {
  return sha256([
    item.transactionHash,
    item.asset ?? "",
    item.side ?? "",
    item.price ?? "",
    item.size ?? "",
    item.timestamp ?? ""
  ].join("|"));
}
