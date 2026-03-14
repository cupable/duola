import { findLeader } from "../leaders/service.js";
import { hasPrivateKey } from "../config/secrets.js";
import { curlStatus } from "../utils/curl.js";

export async function runDoctor(alias?: string): Promise<Record<string, unknown>> {
  const leader = alias ? findLeader(alias) : undefined;
  const checks = {
    nodeVersion: process.version,
    leaderExists: alias ? Boolean(leader) : null,
    storedPrivateKey: leader ? hasPrivateKey(leader.alias) : null,
    envPrivateKey: Boolean(process.env.DUOLA_PRIVATE_KEY),
    executionCommand: process.env.DUOLA_EXECUTION_COMMAND ?? null,
    proxy: process.env.POLYMARKET_PROXY_URL ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? null,
    dataApi: await probeUrl("https://data-api.polymarket.com/trades?limit=1"),
    gammaApi: await probeUrl("https://gamma-api.polymarket.com/markets?limit=1"),
    clobApi: await probeUrl("https://clob.polymarket.com/midpoint?token_id=1")
  };

  return {
    alias: alias ?? null,
    ok: computeOverallOk(checks),
    checks
  };
}

async function probeUrl(url: string): Promise<{ ok: boolean; status: string }> {
  return curlStatus(url, 10);
}

function computeOverallOk(checks: Record<string, unknown>): boolean {
  const apiChecks = ["dataApi", "gammaApi", "clobApi"]
    .map((key) => checks[key] as { ok: boolean })
    .every((check) => check.ok);

  const authOk = Boolean(checks.envPrivateKey) || Boolean(checks.storedPrivateKey) || Boolean(checks.executionCommand);
  return apiChecks && authOk;
}
