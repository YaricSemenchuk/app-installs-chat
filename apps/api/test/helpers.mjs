// Общие помощники e2e: HTTP-вызовы, вход по коду из .dev-mail.log, сокеты.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { io } from "socket.io-client";

export const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
export const DOMAIN = "promobile.test";
export const run = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const MAIL_LOG = resolve(process.cwd(), ".dev-mail.log");
const sockets = [];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function lastMailTo(email, since) {
  for (let i = 0; i < 40; i++) {
    const lines = (await readFile(MAIL_LOG, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
    const mail = lines.map((l) => JSON.parse(l)).reverse().find((m) => m.to === email && m.at >= since);
    if (mail) return mail;
    await sleep(100);
  }
  throw new Error(`no mail to ${email}`);
}

export async function call(cookie, method, path, body, extraHeaders = {}) {
  const res = await fetch(BASE + path, {
    method,
    redirect: "manual",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

export const cookieFrom = (headers, name) => {
  const m = (headers.get("set-cookie") ?? "").match(new RegExp(`${name}=([^;]+)`));
  return m ? `${name}=${m[1]}` : null;
};

// Запросить код и вернуть письмо (с кодом или с отказом).
export async function requestCode(email, inviteToken) {
  const since = new Date().toISOString();
  const res = await call(null, "POST", "/api/auth/email/start", { email, ...(inviteToken ? { inviteToken } : {}) });
  assert.equal(res.status, 204, JSON.stringify(res.body));
  return lastMailTo(email, since);
}

export async function login(email, inviteToken) {
  const mail = await requestCode(email, inviteToken);
  const code = mail.subject.match(/(\d{6})/)?.[1];
  assert.ok(code, `expected a code, got: ${mail.subject}`);
  const res = await call(null, "POST", "/api/auth/email/verify", { email, code });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const sid = cookieFrom(res.headers, "sid");
  assert.ok(sid, "session cookie");
  return sid;
}

export function connect(cookie, lastEventId = 0) {
  const events = [];
  const presence = [];
  const socket = io(BASE, { path: "/ws", transports: ["websocket"], extraHeaders: cookie ? { cookie } : {}, reconnection: false });
  sockets.push(socket);
  socket.on("events", (batch) => events.push(...batch));
  socket.on("presence", (p) => presence.push(p));
  const synced = new Promise((resolveSynced, reject) => {
    socket.on("synced", resolveSynced);
    socket.on("resync", () => reject(new Error("unexpected resync")));
    socket.on("unauthorized", () => reject(new Error("unauthorized")));
    socket.on("disconnect", (reason) => reject(new Error(`disconnected: ${reason}`)));
    socket.on("connect_error", reject);
  });
  synced.catch(() => {});
  socket.on("connect", () => socket.emit("hello", { lastEventId }));
  return { socket, events, presence, synced };
}

export function closeSockets() {
  sockets.forEach((s) => s.disconnect());
}

export async function waitFor(pred, ms = 3000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const hit = pred();
    if (hit) return hit;
    await sleep(25);
  }
  throw new Error("timed out");
}

export const send = (cookie, convId, text, clientMsgId = randomUUID()) =>
  call(cookie, "POST", `/api/conversations/${convId}/messages`, { clientMsgId, text });

export const boot = async (cookie) => (await call(cookie, "GET", "/api/boot")).body;

export const inviteTokenFrom = (mail) => mail.text.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1];
