import { curlJson } from "../../utils/curl.js";

export async function fetchJson<T>(url: string): Promise<T> {
  return curlJson<T>(url, 20);
}
