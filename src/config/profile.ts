import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { profilesDir, ensureAppDirs } from "./paths.js";
import { getDb } from "../db/client.js";

export interface FollowProfile {
  leader: {
    alias: string;
    address: string;
  };
  mode: "mirror";
  poll_interval_sec: number;
  signal_window_sec: number;
  filters: {
    categories_allow: string[];
    categories_deny: string[];
    min_liquidity_usd: number;
    min_time_to_expiry_sec: number;
  };
  sizing: {
    type: "fixed";
    fixed_usd: number;
    min_usd: number;
    max_usd: number;
  };
  execution: {
    mode: "auto" | "taker";
    max_slippage_bps: number;
  };
  risk: {
    max_daily_loss_usd: number;
    max_drawdown_pct: number;
    max_open_positions: number;
    max_per_market_usd: number;
    cooldown_sec: number;
    allow_live: boolean;
  };
}

function buildProfilePath(alias: string): string {
  return path.join(profilesDir, `${alias}.yml`);
}

export function createDefaultProfile(alias: string, address: string, profileName: string): FollowProfile {
  const profileMap: Record<string, Partial<FollowProfile>> = {
    conservative: {
      poll_interval_sec: 15,
      signal_window_sec: 20
    },
    balanced: {
      poll_interval_sec: 10,
      signal_window_sec: 20
    },
    aggressive: {
      poll_interval_sec: 5,
      signal_window_sec: 15
    }
  };

  const preset = profileMap[profileName] ?? profileMap.balanced;

  return {
    leader: {
      alias,
      address
    },
    mode: "mirror",
    poll_interval_sec: preset.poll_interval_sec ?? 10,
    signal_window_sec: preset.signal_window_sec ?? 20,
    filters: {
      categories_allow: [],
      categories_deny: [],
      min_liquidity_usd: 5000,
      min_time_to_expiry_sec: 3600
    },
    sizing: {
      type: "fixed",
      fixed_usd: profileName === "conservative" ? 10 : profileName === "aggressive" ? 50 : 25,
      min_usd: 5,
      max_usd: 100
    },
    execution: {
      mode: "auto",
      max_slippage_bps: 50
    },
    risk: {
      max_daily_loss_usd: profileName === "aggressive" ? 200 : 100,
      max_drawdown_pct: profileName === "aggressive" ? 25 : 20,
      max_open_positions: 15,
      max_per_market_usd: 200,
      cooldown_sec: 1800,
      allow_live: false
    }
  };
}

export function saveProfile(profile: FollowProfile): string {
  ensureAppDirs();
  const profilePath = buildProfilePath(profile.leader.alias);
  fs.writeFileSync(profilePath, YAML.stringify(profile), "utf8");

  const db = getDb();
  db.prepare(`
    INSERT INTO profiles (alias, profile_path, updated_at)
    VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(alias) DO UPDATE SET
      profile_path = excluded.profile_path,
      updated_at = excluded.updated_at
  `).run(profile.leader.alias, profilePath);

  return profilePath;
}

export function loadProfile(alias: string): FollowProfile {
  const profilePath = buildProfilePath(alias);

  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile not found for alias: ${alias}`);
  }

  const raw = fs.readFileSync(profilePath, "utf8");
  return YAML.parse(raw) as FollowProfile;
}

export function setProfileValue(alias: string, keyPath: string, value: string): FollowProfile {
  const profile = loadProfile(alias);
  const segments = keyPath.split(".");
  let cursor: Record<string, unknown> = profile as unknown as Record<string, unknown>;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const next = cursor[segment];

    if (!next || typeof next !== "object") {
      throw new Error(`Invalid config path: ${keyPath}`);
    }

    cursor = next as Record<string, unknown>;
  }

  const finalKey = segments[segments.length - 1];
  const currentValue = cursor[finalKey];
  cursor[finalKey] = parseConfigValue(value, currentValue);
  saveProfile(profile);
  return profile;
}

function parseConfigValue(raw: string, currentValue: unknown): unknown {
  if (typeof currentValue === "number") {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`Expected numeric value, got: ${raw}`);
    }
    return value;
  }

  if (typeof currentValue === "boolean") {
    if (raw === "true") {
      return true;
    }
    if (raw === "false") {
      return false;
    }
    throw new Error(`Expected boolean value, got: ${raw}`);
  }

  if (Array.isArray(currentValue)) {
    if (raw.trim() === "") {
      return [];
    }
    return raw.split(",").map((item) => item.trim()).filter(Boolean);
  }

  return raw;
}
