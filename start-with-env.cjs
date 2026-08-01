#!/usr/bin/env node
// Wrapper to load .env and exec Outline server.
// Bypasses Outline's built-in dotenvx loader which seems to have issues.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const envPath = path.resolve(__dirname, ".env");
const envContent = fs.readFileSync(envPath, "utf8");
const env = { ...process.env };

for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  // Strip surrounding quotes
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  env[key] = value;
}

console.log(`[wrapper] Loaded ${Object.keys(env).length} env vars from .env`);

// Force these for source build
env.NODE_ENV = "production"; // Outline app requires this exact value
env.ENVIRONMENT = "production"; // Outline's own env var (alias of NODE_ENV)
env.FILE_STORAGE_LOCAL_ROOT = "/home/lucas/.outline-data";

const child = spawn("node", ["./build/server/index.js"], {
  stdio: "inherit",
  env,
});

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
