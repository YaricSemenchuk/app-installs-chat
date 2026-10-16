// Сквозная проверка M0 против запущенного API (npm run dev или npm start).
// Коды входа берутся из .dev-mail.log — его пишет MailService, когда RESEND_API_KEY не задан.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { io } from "socket.io-client";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const DOMAIN = process.env.E2E_EMAIL_DOMAIN ?? "promobile.test";
const MAIL_LOG = resolve(process.cwd(), ".dev-mail.log");
const run = Date.now().toString(36);
const sockets = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lastMailTo(email, since) {
  for (let i = 0; i < 40; i++) {
    const lines = (await readFile(MAIL_LOG, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
    const mail = lines.map((l) => JSON.parse(l)).reverse().find((m) => m.to === email && m.at >= since);
    if (mail) return mail;
    await sleep(100);
  }
  throw new Error(`no mail to ${email}`);
}

async function call(cookie, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function login(email) {
  const since = new Date().toISOString();
  assert.equal((await call(null, "POST", "/api/auth/email/start", { email })).status, 204);
  const mail = await lastMailTo(email, since);
  const code = mail.subject.match(/(\d{6})/)?.[1];
  assert.ok(code, `code in subject: ${mail.subject}`);
  const res = await call(null, "POST", "/api/auth/email/verify", { email, code });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const sid = res.headers.get("set-cookie")?.match(/sid=([^;]+)/)?.[1];
  assert.ok(sid, "session cookie");
  return `sid=${sid}`;
}

function connect(cookie, lastEventId) {
  const events = [];
  const socket = io(BASE, { path: "/ws", transports: ["websocket"], extraHeaders: cookie ? { cookie } : {}, reconnection: false });
  sockets.push(socket);
  socket.on("events", (batch) => events.push(...batch));
  const synced = new Promise((resolveSynced, reject) => {
    socket.on("synced", resolveSynced);
    socket.on("resync", () => reject(new Error("unexpected resync")));
    socket.on("unauthorized", () => reject(new Error("unauthorized")));
    socket.on("disconnect", (reason) => reject(new Error(`disconnected: ${reason}`)));
    socket.on("connect_error", reject);
  });
  socket.on("connect", () => socket.emit("hello", { lastEventId }));
  return { socket, events, synced };
}

async function waitFor(pred, ms = 3000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const hit = pred();
    if (hit) return hit;
    await sleep(25);
  }
  throw new Error("timed out");
}

const send = (cookie, convId, text, clientMsgId = randomUUID()) =>
  call(cookie, "POST", `/api/conversations/${convId}/messages`, { clientMsgId, text });

describe("M0 vertical slice", () => {
  let anna, boris, general, annaBoot;

  before(async () => {
    anna = await login(`anna.${run}@${DOMAIN}`);
    boris = await login(`boris.${run}@${DOMAIN}`);
    annaBoot = (await call(anna, "GET", "/api/boot")).body;
    general = annaBoot.conversations.find((c) => c.isGeneral);
  });

  after(() => sockets.forEach((s) => s.disconnect()));

  test("people from an allowed domain join and land in #general", () => {
    assert.ok(general, "#general in boot");
    assert.equal(general.name, "general");
    assert.ok(annaBoot.users.some((u) => u.email === `boris.${run}@${DOMAIN}`), "boris is in the directory");
  });

  test("a message reaches the other member in real time, once", async () => {
    const live = connect(anna, annaBoot.lastEventId);
    await live.synced;

    const clientMsgId = randomUUID();
    const first = await send(boris, general.id, "Привет из e2e", clientMsgId);
    assert.equal(first.status, 201);
    const ev = await waitFor(() => live.events.find((e) => e.kind === "message.created" && e.payload.id === first.body.id));
    assert.equal(ev.payload.text, "Привет из e2e");

    const retry = await send(boris, general.id, "Привет из e2e", clientMsgId);
    assert.equal(retry.body.id, first.body.id, "same clientMsgId returns the stored message");
    await sleep(300);
    assert.equal(live.events.filter((e) => e.payload?.id === first.body.id).length, 1, "no duplicate event");
    live.socket.disconnect();
  });

  test("history pages backwards without gaps", async () => {
    for (let i = 0; i < 55; i++) await send(boris, general.id, `пачка ${i}`);
    const page1 = (await call(anna, "GET", `/api/conversations/${general.id}/messages?limit=50`)).body;
    assert.equal(page1.messages.length, 50);
    assert.equal(page1.hasMore, true);
    assert.equal(page1.messages.at(-1).text, "пачка 54");
    const page2 = (await call(anna, "GET", `/api/conversations/${general.id}/messages?limit=50&before=${page1.messages[0].seq}`)).body;
    assert.ok(page2.messages.length > 0);
    assert.ok(page2.messages.at(-1).seq < page1.messages[0].seq);
    const seqs = [...page2.messages, ...page1.messages].map((m) => m.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), "ascending order across pages");
  });

  test("after a dropped connection the client catches up", async () => {
    const boot = (await call(anna, "GET", "/api/boot")).body;
    const missed = await send(boris, general.id, "пока тебя не было");
    const back = connect(anna, boot.lastEventId);
    await back.synced;
    assert.ok(back.events.some((e) => e.kind === "message.created" && e.payload.id === missed.body.id));
    back.socket.disconnect();
  });

  test("read cursor clears unread and syncs to the reader's other devices", async () => {
    const before = (await call(anna, "GET", "/api/boot")).body;
    const conv = before.conversations.find((c) => c.id === general.id);
    assert.ok(conv.unreadCount > 0, "boris's messages are unread for anna");

    const other = connect(anna, before.lastEventId);
    await other.synced;
    const res = await call(anna, "POST", `/api/conversations/${general.id}/read`, { seq: conv.latestSeq });
    assert.equal(res.body.lastReadSeq, conv.latestSeq);
    await waitFor(() => other.events.find((e) => e.kind === "read.updated" && e.payload.lastReadSeq === conv.latestSeq));

    const after = (await call(anna, "GET", "/api/boot")).body;
    assert.equal(after.conversations.find((c) => c.id === general.id).unreadCount, 0);
    const back = await call(anna, "POST", `/api/conversations/${general.id}/read`, { seq: 1 });
    assert.equal(back.body.lastReadSeq, conv.latestSeq, "cursor never moves backwards");
    other.socket.disconnect();
  });

  test("sign-in refuses wrong codes and unknown domains without revealing accounts", async () => {
    const email = `cara.${run}@${DOMAIN}`;
    assert.equal((await call(null, "POST", "/api/auth/email/start", { email })).status, 204);
    const wrong = await call(null, "POST", "/api/auth/email/verify", { email, code: "000000" });
    assert.equal(wrong.status, 400);

    const outsider = `eve.${run}@elsewhere.test`;
    const since = new Date().toISOString();
    assert.equal((await call(null, "POST", "/api/auth/email/start", { email: outsider })).status, 204);
    const mail = await lastMailTo(outsider, since);
    assert.match(mail.text, /нет доступа/);
  });

  test("guards: session required, JSON required, sockets need a session", async () => {
    assert.equal((await call(null, "GET", "/api/boot")).status, 401);
    const form = await fetch(`${BASE}/api/conversations/${general.id}/messages`, {
      method: "POST",
      headers: { cookie: anna, "content-type": "application/x-www-form-urlencoded" },
      body: "text=hi",
    });
    assert.equal(form.status, 415);
    const stranger = connect(null, 0);
    await assert.rejects(stranger.synced);
  });
});
