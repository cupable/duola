import { addLeader, findLeader } from "../leaders/service.js";
import { savePrivateKey, hasPrivateKey, deletePrivateKey } from "../config/secrets.js";
import { createDefaultProfile, loadProfile, saveProfile } from "../config/profile.js";
import { syncLeader } from "../sync/service.js";
import { startFollowRunner, stopFollowRunner, getFollowStatus } from "../follow/runner.js";
import { getBackgroundState, startDetachedProcess, stopDetachedProcess } from "../follow/background.js";

export interface OnboardResult {
  alias: string;
  leaderAdded: boolean;
  privateKeyStored: boolean;
  sync: Awaited<ReturnType<typeof syncLeader>>;
  profilePath: string;
  profile: ReturnType<typeof loadProfile>;
}

export async function autopilotOnboard(
  leaderAddress: string,
  alias: string,
  privateKey: string,
  profileName: string,
  syncLimit: number
): Promise<OnboardResult> {
  let leader = findLeader(alias) ?? findLeader(leaderAddress);
  let leaderAdded = false;

  if (!leader) {
    leader = addLeader(alias, leaderAddress);
    leaderAdded = true;
  }

  const profile = createDefaultProfile(leader.alias, leader.address, profileName);
  profile.risk.allow_live = true;
  const profilePath = saveProfile(profile);
  savePrivateKey(leader.alias, privateKey);
  const sync = await syncLeader(leader.alias, syncLimit);

  return {
    alias: leader.alias,
    leaderAdded,
    privateKeyStored: true,
    sync,
    profilePath,
    profile: loadProfile(leader.alias)
  };
}

export async function autopilotStart(
  alias: string,
  confirmation: string,
  options?: { maxCycles?: number; detach?: boolean }
): Promise<Record<string, unknown>> {
  const leader = findLeader(alias);
  if (!leader) {
    throw new Error(`Leader not found: ${alias}`);
  }

  const profile = loadProfile(leader.alias);
  if (!profile.risk.allow_live) {
    profile.risk.allow_live = true;
    saveProfile(profile);
  }

  const sync = await syncLeader(leader.alias, 50);
  const run = options?.detach
    ? startDetachedProcess(leader.alias, confirmation, options.maxCycles)
    : await startFollowRunner(leader.alias, {
        maxCycles: options?.maxCycles
      });

  return {
    alias: leader.alias,
    sync,
    run
  };
}

export function autopilotStop(alias: string): Record<string, unknown> {
  const follow = stopFollowRunner(alias);
  const background = stopDetachedProcess(alias);
  return {
    ...follow,
    background
  };
}

export function autopilotStatus(alias: string): Record<string, unknown> {
  const leader = findLeader(alias);
  if (!leader) {
    throw new Error(`Leader not found: ${alias}`);
  }

  return {
    alias: leader.alias,
    hasStoredPrivateKey: hasPrivateKey(leader.alias),
    follow: getFollowStatus(leader.alias),
    background: getBackgroundState(leader.alias)
  };
}

export function autopilotResetSecret(alias: string): Record<string, unknown> {
  const leader = findLeader(alias);
  if (!leader) {
    throw new Error(`Leader not found: ${alias}`);
  }

  return {
    alias: leader.alias,
    secretDeleted: deletePrivateKey(leader.alias)
  };
}
