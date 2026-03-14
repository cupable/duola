import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const homeDir = os.homedir();

export const duolaHome = process.env.DUOLA_HOME
  ? path.resolve(process.env.DUOLA_HOME)
  : path.join(homeDir, ".duola");
export const dbPath = path.join(duolaHome, "duola.db");
export const profilesDir = path.join(duolaHome, "profiles");
export const reportsDir = path.join(duolaHome, "reports");
export const secretsDir = path.join(duolaHome, "secrets");
export const runtimeDir = path.join(duolaHome, "runtime");

export function ensureAppDirs(): void {
  fs.mkdirSync(duolaHome, { recursive: true });
  fs.mkdirSync(profilesDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(secretsDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
}
