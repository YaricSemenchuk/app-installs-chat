// M5: настройки и серверное решение об уведомлениях, вход в десктоп-приложение через Google, /desktop.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { DOMAIN, boot, call, closeSockets, connect, cookieFrom, login, run, send, sleep, waitFor } from "./helpers.mjs";

const DEFAULTS = { notifyLevel: "mentions", desktopNotifications: true, notifyThreadReplies: true, showMessagePreview: true, sound: true };

// Сокет, который копит уведомления.
async function listen(cookie) {
  const live = connect(cookie, (await boot(cookie)).lastEventId);
  const notes = [];
  live.socket.on("notification", (n) => notes.push(n));
  await live.synced;
  return { ...live, notes };
}

describe("M5 notifications", () => {
  let owner, anna, boris, ch, dm, annaId, borisId, borisName;

  before(async () => {
    owner = await login(`owner@${DOMAIN}`);
    anna = await login(`anna5.${run}@${DOMAIN}`);
    boris = await login(`boris5.${run}@${DOMAIN}`);
    annaId = (await boot(anna)).me.id;
    const b = (await boot(boris)).me;
    borisId = b.id;
    borisName = b.displayName;
    ch = (await call(owner, "POST", "/api/conversations", { name: `m5-${run}`, memberIds: [annaId, borisId] })).body;
    dm = (await call(anna, "POST", "/api/conversations/dm", { userIds: [borisId] })).body;
  });
  after(closeSockets);

  // «Тихое» сообщение проверяем маркером: после него шлём ЛС, ждём его уведомление и чуть дольше.
  async function expectSilence(live, sentId) {
    const marker = (await send(anna, dm.id, `маркер ${randomUUID()}`)).body;
    await waitFor(() => live.notes.find((n) => n.messageId === marker.id));
    await sleep(150);
    assert.ok(!live.notes.some((n) => n.messageId === sentId), "no notification expected");
  }

  test("boot carries the defaults; a change reaches the person's other devices", async () => {
    assert.deepEqual((await boot(boris)).preferences, DEFAULTS);
    const other = connect(boris, (await boot(boris)).lastEventId);
    await other.synced;
    const res = await call(boris, "PATCH", "/api/me/preferences", { sound: false });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ...DEFAULTS, sound: false });
    const ev = await waitFor(() => other.events.find((e) => e.kind === "preferences.updated"));
    assert.equal(ev.payload.sound, false);
    assert.equal((await call(boris, "PATCH", "/api/me/preferences", { notifyLevel: "loud" })).status, 400);
    await call(boris, "PATCH", "/api/me/preferences", { sound: true });
    other.socket.disconnect();
  });

  test("on the default level: DMs and mentions notify, plain channel messages don't, the author never", async () => {
    const live = await listen(boris);
    const author = await listen(anna);

    const direct = (await send(anna, dm.id, "Есть минутка? *Важно*")).body;
    const n = await waitFor(() => live.notes.find((x) => x.messageId === direct.id));
    assert.equal(n.reason, "dm");
    assert.equal(n.conversationId, dm.id);
    assert.equal(n.authorId, annaId);
    assert.equal(n.body, "Есть минутка? Важно", "markup is flattened to text");
    assert.equal(n.sound, true);

    const plain = (await send(anna, ch.id, "обычное сообщение в канал")).body;
    await expectSilence(live, plain.id);

    const mention = (await send(anna, ch.id, `<@${borisId}> глянь макет`)).body;
    const m = await waitFor(() => live.notes.find((x) => x.messageId === mention.id));
    assert.equal(m.reason, "mention");
    assert.equal(m.title, `#${ch.name}`);
    assert.match(m.body, new RegExp(`: @${borisName} глянь макет$`));

    await sleep(150);
    assert.equal(author.notes.length, 0, "nobody is notified about their own messages");
    live.socket.disconnect();
    author.socket.disconnect();
  });

  test("levels and switches: all, nothing, desktop off, preview off", async () => {
    const live = await listen(boris);
    await call(boris, "PATCH", "/api/me/preferences", { notifyLevel: "all" });
    const plain = (await send(anna, ch.id, "теперь и это")).body;
    assert.equal((await waitFor(() => live.notes.find((x) => x.messageId === plain.id))).reason, "message");

    await call(boris, "PATCH", "/api/me/preferences", { notifyLevel: "mentions", showMessagePreview: false });
    const secret = (await send(anna, dm.id, "пароль от стенда")).body;
    assert.equal((await waitFor(() => live.notes.find((x) => x.messageId === secret.id))).body, "Новое сообщение");

    await call(boris, "PATCH", "/api/me/preferences", { notifyLevel: "nothing", showMessagePreview: true });
    const quiet = (await send(anna, dm.id, "и это не слышно")).body;
    await sleep(300);
    assert.ok(!live.notes.some((x) => x.messageId === quiet.id), "nothing means nothing, DMs included");

    await call(boris, "PATCH", "/api/me/preferences", { notifyLevel: "mentions", desktopNotifications: false });
    const off = (await send(anna, dm.id, "уведомления выключены")).body;
    await sleep(300);
    assert.ok(!live.notes.some((x) => x.messageId === off.id));

    await call(boris, "PATCH", "/api/me/preferences", DEFAULTS);
    live.socket.disconnect();
  });

  test("thread replies notify followers unless they turned that off", async () => {
    const live = await listen(boris);
    const parent = (await send(boris, ch.id, "Кто посмотрит ревью?")).body; // автор родителя следит за тредом
    const reply = (
      await call(anna, "POST", `/api/conversations/${ch.id}/messages`, { clientMsgId: randomUUID(), text: "я посмотрю", parentId: parent.id })
    ).body;
    const n = await waitFor(() => live.notes.find((x) => x.messageId === reply.id));
    assert.equal(n.reason, "thread_reply");
    assert.equal(n.parentId, parent.id);
    assert.equal(n.title, `Тред в #${ch.name}`);

    await call(boris, "PATCH", "/api/me/preferences", { notifyThreadReplies: false });
    const second = (
      await call(anna, "POST", `/api/conversations/${ch.id}/messages`, { clientMsgId: randomUUID(), text: "готово", parentId: parent.id })
    ).body;
    await expectSilence(live, second.id);
    await call(boris, "PATCH", "/api/me/preferences", DEFAULTS);
    live.socket.disconnect();
  });
});

describe("M5 desktop sign-in and downloads", () => {
  let server;
  let nextProfile;
  let lastChallenge;
  const port = Number(process.env.E2E_GOOGLE_PORT ?? 3299);

  before(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const form = new URLSearchParams(body);
        const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
        if (req.url !== "/token" || challenge !== lastChallenge) {
          res.writeHead(400).end("{}");
          return;
        }
        const claims = { iss: "https://accounts.google.com", aud: "e2e-client", exp: Math.floor(Date.now() / 1000) + 300, ...nextProfile };
        const idToken = ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id_token: idToken }));
      });
    });
    await new Promise((r) => server.listen(port, r));
  });
  after(() => server.close());

  // Как это делает Electron: свой verifier, на сервер уходит только его хэш.
  async function desktopFlow(profile) {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    nextProfile = profile;
    const start = await call(null, "GET", `/api/auth/google/start?desktop=${challenge}`);
    const to = new URL(start.headers.get("location"));
    lastChallenge = to.searchParams.get("code_challenge");
    const cb = await call(cookieFrom(start.headers, "g_oauth"), "GET", `/api/auth/google/callback?code=abc&state=${to.searchParams.get("state")}`);
    return { verifier, cb };
  }

  test("Google in the system browser hands a one-time code to the app instead of a browser session", async () => {
    const email = `desk.${run}@${DOMAIN}`;
    const { verifier, cb } = await desktopFlow({ sub: `g-desk-${run}`, email, email_verified: true, name: "Desk Top" });
    assert.equal(cb.status, 302);
    assert.equal(cookieFrom(cb.headers, "sid"), null, "the browser doesn't get signed in");
    const code = new URL(cb.headers.get("location"), "http://x").searchParams.get("code");
    assert.match(cb.headers.get("location"), /^\/desktop-auth\?code=/);

    const wrong = randomBytes(32).toString("base64url");
    assert.equal((await call(null, "POST", "/api/auth/desktop/exchange", { code, verifier: wrong })).status, 400, "a stolen code alone is useless");
    const ok = await call(null, "POST", "/api/auth/desktop/exchange", { code, verifier });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.user.email, email);
    const sid = cookieFrom(ok.headers, "sid");
    assert.equal((await boot(sid)).me.email, email);
    assert.equal((await call(null, "POST", "/api/auth/desktop/exchange", { code, verifier })).status, 400, "one use only");
  });

  test("a handoff code expires after a minute", async () => {
    const { verifier, cb } = await desktopFlow({ sub: `g-desk-${run}`, email: `desk.${run}@${DOMAIN}`, email_verified: true, name: "Desk Top" });
    const code = new URL(cb.headers.get("location"), "http://x").searchParams.get("code");
    const { default: pg } = await import("pg");
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query("update auth_handoffs set expires_at = now() - interval '1 second' where consumed_at is null");
    await db.end();
    assert.equal((await call(null, "POST", "/api/auth/desktop/exchange", { code, verifier })).status, 400);
  });

  test("the download page data is public", async () => {
    const res = await call(null, "GET", "/api/desktop");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { version: "1.0.0", macUrl: "https://downloads.example.test/TeamChat-1.0.0.dmg", winUrl: null });
  });
});
