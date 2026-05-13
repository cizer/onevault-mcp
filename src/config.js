import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// Load .env manually (no dotenv dependency)
function loadEnv() {
  try {
    const envPath = resolve(projectRoot, ".env");
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env is optional if env vars are set externally
  }
}

loadEnv();

export const config = {
  vaultPath: process.env.VAULT_PATH,
  dbPath: process.env.DB_PATH || resolve(projectRoot, "vault.db"),
  excludeDirs: (process.env.EXCLUDE_DIRS || ".obsidian,.trash")
    .split(",")
    .map((d) => d.trim()),
};

if (!config.vaultPath) {
  throw new Error("VAULT_PATH environment variable is required");
}
