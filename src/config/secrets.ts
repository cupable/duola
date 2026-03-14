import fs from "node:fs";
import path from "node:path";
import { ensureAppDirs, secretsDir } from "./paths.js";

interface StoredSecret {
  alias: string;
  privateKey: string;
  createdAt: string;
  updatedAt: string;
}

function getSecretPath(alias: string): string {
  return path.join(secretsDir, `${alias}.json`);
}

export function savePrivateKey(alias: string, privateKey: string): string {
  ensureAppDirs();
  const filePath = getSecretPath(alias);
  const now = new Date().toISOString();
  const existing = fs.existsSync(filePath) ? loadPrivateKeyRecord(alias) : null;
  const payload: StoredSecret = {
    alias,
    privateKey,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), {
    encoding: "utf8",
    mode: 0o600
  });
  fs.chmodSync(filePath, 0o600);
  return filePath;
}

export function loadPrivateKey(alias: string): string | null {
  const record = loadPrivateKeyRecord(alias);
  return record?.privateKey ?? null;
}

export function hasPrivateKey(alias: string): boolean {
  return fs.existsSync(getSecretPath(alias));
}

export function deletePrivateKey(alias: string): boolean {
  const filePath = getSecretPath(alias);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  fs.unlinkSync(filePath);
  return true;
}

function loadPrivateKeyRecord(alias: string): StoredSecret | null {
  const filePath = getSecretPath(alias);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as StoredSecret;
}
