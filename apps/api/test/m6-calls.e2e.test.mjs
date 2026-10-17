// M6: звонки. Сервер выдаёт токены LiveKit, звонит в ЛС, помнит, кто в звонке, и закрывает пустые.
// LiveKit здесь поддельный: отвечает на API комнат и запоминает удалённые комнаты.
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { AccessToken } from "livekit-server-sdk";
import { BASE, DOMAIN, boot, call, closeSockets, connect, login, run, waitFor } from "./helpers.mjs";

const KEY = process.env.LIVEKIT_API_KEY;
const SECRET = process.env.LIVEKIT_API_SECRET;
const deletedRooms = [];

const claims = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

// Вебхук, подписанный как это делает LiveKit: JWT ключом API с sha256 тела.
async function webhook(body, secret = SECRET) {
  const text = JSON.stringify(body);
  const at = new AccessToken(KEY, secret);
  at.sha256 = createHash("sha256").update(text).digest("base64");
  return fetch(`${BASE}/api/livekit/webhook`, {
    method: "POST",
    headers: { "content-type": "application/webhook+json", authorization: await at.toJwt() },
    body: text,
  });
}

describe("M6 calls", () => {
  let livekit, anna, boris, carl, annaId, borisId, dm, channel, annaLive, borisLive;
  const callEvents = (live) => {
    const list = [];
    live.socket.on("call", (e) => list.push(e));
    return list;
  };
  let annaCalls, borisCalls;

  before(async () => {
    livekit = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        if (req.url.endsWith("/DeleteRoom")) {
          deletedRooms.push(JSON.parse(body).room);
          res.end("{}");
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ code: "not_found", msg: "room not found" }));
        }
      });
    });
    await new Promise((r) => livekit.listen(Number(process.env.E2E_LIVEKIT_PORT), r));

    anna = await login(`anna8.${run}@${DOMAIN}`);
    boris = await login(`boris8.${run}@${DOMAIN}`);
    carl = await login(`carl8.${run}@${DOMAIN}`);
    annaId = (await boot(anna)).me.id;
    borisId = (await boot(boris)).me.id;
    dm = (await call(anna, "POST", "/api/conversations/dm", { userIds: [borisId] })).body;
    channel = (await call(anna, "POST", "/api/conversations", { name: `calls-${run}`, memberIds: [borisId] })).body;
    annaLive = connect(anna, (await boot(anna)).lastEventId);
    borisLive = connect(boris, (await boot(boris)).lastEventId);
    await Promise.all([annaLive.synced, borisLive.synced]);
    annaCalls = callEvents(annaLive);
    borisCalls = callEvents(borisLive);
  });
  after(async () => {
    closeSockets();
    await new Promise((r) => livekit.close(r));
  });

  test("a DM call rings the other person and gives each a LiveKit token for one room", async () => {
    assert.deepEqual((await call(anna, "GET", "/api/calls")).body, { enabled: true, calls: [] });

    const started = await call(anna, "POST", `/api/conversations/${dm.id}/call`, {});
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const { call: c, url, token } = started.body;
    assert.equal(url, process.env.LIVEKIT_URL);
    assert.deepEqual(c.participantIds, [annaId]);
    const t = claims(token);
    assert.equal(t.sub, annaId, "identity is the user id");
    assert.equal(t.iss, KEY);
    assert.match(t.video.room, /^call-[0-9a-f-]{36}$/);
    assert.equal(t.video.roomJoin, true);
    assert.equal(t.video.canPublish, true);

    const ring = await waitFor(() => borisCalls.find((e) => e.kind === "ring" && e.call.id === c.id));
    assert.equal(ring.from, annaId);
    assert.ok(!annaCalls.some((e) => e.kind === "ring"), "the caller is not rung");
    assert.deepEqual((await call(boris, "GET", "/api/calls")).body.calls.map((x) => x.id), [c.id]);

    // Принять — это тот же запрос: попадаешь в идущий звонок и ту же комнату.
    const accepted = await call(boris, "POST", `/api/conversations/${dm.id}/call`, {});
    assert.equal(accepted.body.call.id, c.id);
    assert.equal(claims(accepted.body.token).video.room, t.video.room);
    assert.deepEqual(new Set(accepted.body.call.participantIds), new Set([annaId, borisId]));
    await waitFor(() => borisCalls.find((e) => e.kind === "ring.stop" && e.callId === c.id));
    await waitFor(() => annaCalls.find((e) => e.kind === "updated" && e.call.participantIds.length === 2));

    // Чужой ЛС не видит и не может в него войти.
    assert.equal((await call(carl, "POST", `/api/conversations/${dm.id}/call`, {})).status, 404);
    assert.equal((await call(carl, "POST", `/api/calls/${c.id}/leave`, {})).status, 404);
    assert.deepEqual((await call(carl, "GET", "/api/calls")).body.calls, []);

    // Ушла Анна — Борис ещё в звонке; ушёл и он — звонок окончен, комната в LiveKit удалена.
    assert.equal((await call(anna, "POST", `/api/calls/${c.id}/leave`, {})).status, 204);
    await waitFor(() => borisCalls.find((e) => e.kind === "updated" && e.call.id === c.id && e.call.participantIds.length === 1));
    assert.equal((await call(boris, "POST", `/api/calls/${c.id}/leave`, {})).status, 204);
    await waitFor(() => annaCalls.find((e) => e.kind === "ended" && e.callId === c.id));
    assert.deepEqual((await call(anna, "GET", "/api/calls")).body.calls, []);
    await waitFor(() => deletedRooms.includes(t.video.room));
  });

  test("declining a 1:1 call ends it for the caller", async () => {
    const c = (await call(anna, "POST", `/api/conversations/${dm.id}/call`, {})).body.call;
    await waitFor(() => borisCalls.find((e) => e.kind === "ring" && e.call.id === c.id));
    assert.equal((await call(boris, "POST", `/api/calls/${c.id}/decline`, {})).status, 204);
    await waitFor(() => annaCalls.find((e) => e.kind === "declined" && e.callId === c.id && e.userId === borisId));
    await waitFor(() => annaCalls.find((e) => e.kind === "ended" && e.callId === c.id));
    assert.deepEqual((await call(anna, "GET", "/api/calls")).body.calls, []);
  });

  test("a channel call is a huddle: no ringing, members join, outsiders cannot", async () => {
    const ringsBefore = borisCalls.filter((e) => e.kind === "ring").length;
    const started = (await call(anna, "POST", `/api/conversations/${channel.id}/call`, {})).body;
    await waitFor(() => borisCalls.find((e) => e.kind === "updated" && e.call.id === started.call.id));
    assert.equal(borisCalls.filter((e) => e.kind === "ring").length, ringsBefore, "channels do not ring");
    // Канал открытый: посторонний его видит, но без вступления в созвон не попадёт.
    assert.equal((await call(carl, "POST", `/api/conversations/${channel.id}/call`, {})).status, 403);
    // Второе «начать» не создаёт второй звонок.
    const again = (await call(boris, "POST", `/api/conversations/${channel.id}/call`, {})).body;
    assert.equal(again.call.id, started.call.id);
    assert.equal((await call(anna, "POST", `/api/conversations/${randomUUID()}/call`, {})).status, 404);
  });

  test("LiveKit webhooks are checked by signature and mark people who dropped off", async () => {
    const live = (await call(anna, "GET", "/api/calls")).body.calls.find((c) => c.conversationId === channel.id);
    const room = claims((await call(anna, "POST", `/api/conversations/${channel.id}/call`, {})).body.token).video.room;
    const left = { event: "participant_left", id: randomUUID(), room: { name: room }, participant: { identity: borisId } };

    assert.equal((await webhook(left, "wrong-secret-0123456789abcdef0123456789")).status, 403, "forged signature");
    assert.equal((await webhook(left)).status, 200);
    await waitFor(() => annaCalls.find((e) => e.kind === "updated" && e.call.id === live.id && !e.call.participantIds.includes(borisId)));

    const finished = { event: "room_finished", id: randomUUID(), room: { name: room } };
    assert.equal((await webhook(finished)).status, 200);
    await waitFor(() => annaCalls.find((e) => e.kind === "ended" && e.callId === live.id));
    assert.deepEqual((await call(anna, "GET", "/api/calls")).body.calls, []);
  });
});
