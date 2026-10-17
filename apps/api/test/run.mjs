// e2e: свежая база teamchat_test, свой экземпляр API на отдельном порту, mock Google и LiveKit, node --test.
// Запуск: npm run test:e2e (из корня или apps/api). Нужен Postgres из DATABASE_URL в apps/api/.env.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const root = resolve(import.meta.dirname, "..");
if (existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));

const PORT = 3201;
const GOOGLE_PORT = 3299;
const LIVEKIT_PORT = 3298; // поддельный API комнат LiveKit поднимает m6-calls.e2e.test.mjs
const JIRA_PORT = 3297; // поддельные Jira и Figma поднимает m7-tasks.e2e.test.mjs
const FIGMA_PORT = 3296;
const baseUrl = new URL(process.env.DATABASE_URL);
const testDb = process.env.E2E_DATABASE ?? "teamchat_test";
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${testDb}`;

const admin = new URL(baseUrl);
admin.pathname = "/postgres";
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
await client.query(`drop database if exists "${testDb}" with (force)`);
await client.query(`create database "${testDb}"`);
await client.end();

const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: testUrl.toString(),
  PORT: String(PORT),
  APP_URL: `http://localhost:${PORT}`,
  AUTH_SECRET: "e2e-secret-0123456789abcdef",
  BOOTSTRAP_OWNER_EMAIL: "owner@promobile.test",
  WORKSPACE_NAME: "Promobile",
  ALLOWED_EMAIL_DOMAINS: "promobile.test",
  RESEND_API_KEY: "",
  GOOGLE_CLIENT_ID: "e2e-client",
  GOOGLE_CLIENT_SECRET: "e2e-client-secret",
  GOOGLE_AUTH_URL: `http://localhost:${GOOGLE_PORT}/auth`,
  GOOGLE_TOKEN_URL: `http://localhost:${GOOGLE_PORT}/token`,
  LIVEKIT_URL: `ws://localhost:${LIVEKIT_PORT}`,
  LIVEKIT_API_KEY: "e2e-livekit-key",
  LIVEKIT_API_SECRET: "e2e-livekit-secret-0123456789abcdef0123",
  JIRA_BASE_URL: `http://localhost:${JIRA_PORT}`,
  JIRA_EMAIL: "jira-bot@promobile.test",
  JIRA_API_TOKEN: "e2e-jira-token",
  FIGMA_TOKEN: "e2e-figma-token",
  FIGMA_API_URL: `http://localhost:${FIGMA_PORT}`,
  // Файлы e2e кладут на диск в отдельный каталог, он пересоздаётся при каждом запуске.
  STORAGE_DRIVER: "disk",
  STORAGE_DIR: resolve(root, ".storage-test"),
};
rmSync(env.STORAGE_DIR, { recursive: true, force: true });
env.E2E_SESSION_CACHE = resolve(env.STORAGE_DIR, "..", ".e2e-sessions.json");
rmSync(env.E2E_SESSION_CACHE, { force: true });

execFileSync("npx", ["prisma", "migrate", "deploy"], { cwd: root, env, stdio: "ignore" });

const server = spawn("node", ["dist/main.js"], { cwd: root, env, stdio: ["ignore", "ignore", "inherit"] });
const stop = () => server.kill("SIGTERM");
process.on("exit", stop);

for (let i = 0; ; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/healthz`)).ok) break;
  } catch {}
  if (i > 60) throw new Error("API did not start");
  await new Promise((r) => setTimeout(r, 250));
}

const tests = spawn("node", ["--test", "--test-concurrency=1", "test/*.test.mjs"], {
  cwd: root,
  env: { ...env, E2E_BASE_URL: `http://localhost:${PORT}`, E2E_GOOGLE_PORT: String(GOOGLE_PORT), E2E_LIVEKIT_PORT: String(LIVEKIT_PORT), E2E_JIRA_PORT: String(JIRA_PORT), E2E_FIGMA_PORT: String(FIGMA_PORT) },
  stdio: "inherit",
});
tests.on("exit", (code) => {
  stop();
  process.exit(code ?? 1);
});
