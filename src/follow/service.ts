import { createDefaultProfile, loadProfile, saveProfile, setProfileValue, type FollowProfile } from "../config/profile.js";
import { findLeader } from "../leaders/service.js";

export function initFollowProfile(aliasOrAddress: string, profileName: string): { profile: FollowProfile; path: string } {
  const leader = findLeader(aliasOrAddress);

  if (!leader) {
    throw new Error(`Leader not found: ${aliasOrAddress}`);
  }

  const profile = createDefaultProfile(leader.alias, leader.address, profileName);
  const profilePath = saveProfile(profile);
  return { profile, path: profilePath };
}

export function showFollowProfile(alias: string): FollowProfile {
  return loadProfile(alias);
}

export function updateFollowProfile(alias: string, key: string, value: string): FollowProfile {
  return setProfileValue(alias, key, value);
}
