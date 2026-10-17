// M2: каналы (создание, каталог, вступление, выход, участники, тема, переименование), ЛС, упоминания и счётчики.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { DOMAIN, boot, call, closeSockets, connect, login, run, send, waitFor } from "./helpers.mjs";

const conv = (b, id) => b.conversations.find((c) => c.id === id);

describe("M2 channels and DMs", () => {
  let owner, anna, boris, cara;
  let annaId, borisId, caraId;
  let general, relizy, secret;
  const relName = `relizy-${run}`;

  before(async () => {
    owner = await login(`owner@${DOMAIN}`);
    anna = await login(`anna2.${run}@${DOMAIN}`);
    boris = await login(`boris2.${run}@${DOMAIN}`);
    cara = await login(`cara2.${run}@${DOMAIN}`);
    annaId = (await boot(anna)).me.id;
    borisId = (await boot(boris)).me.id;
    caraId = (await boot(cara)).me.id;
    general = (await boot(owner)).conversations.find((c) => c.isGeneral);
  });
  after(closeSockets);

  test("create a public channel; names are validated and unique", async () => {
    const res = await call(owner, "POST", "/api/conversations", { name: relName, purpose: "Выкатки и откаты" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    relizy = res.body;
    assert.equal(relizy.isMember, true);
    assert.equal(relizy.isManager, true);
    assert.equal((await call(owner, "POST", "/api/conversations", { name: relName })).status, 409);
    assert.equal((await call(owner, "POST", "/api/conversations", { name: "Bad Name" })).status, 400);
  });

  test("the directory lists it; a non-member can read but not post, then joins", async () => {
    const dir = (await call(anna, "GET", `/api/conversations/browse?query=${relName}`)).body;
    const row = dir.find((c) => c.id === relizy.id);
    assert.ok(row && row.isMember === false && row.memberCount === 1);
    await call(owner, "POST", `/api/conversations/${relizy.id}/messages`, { clientMsgId: crypto.randomUUID(), text: "Выкатка в 11:00" });
    assert.equal((await call(anna, "GET", `/api/conversations/${relizy.id}/messages`)).status, 200, "public channels are readable");
    assert.equal((await send(anna, relizy.id, "можно?")).status, 403, "but not writable before joining");

    const live = connect(owner, (await boot(owner)).lastEventId);
    await live.synced;
    const joined = await call(anna, "POST", `/api/conversations/${relizy.id}/join`, {});
    assert.equal(joined.body.isMember, true);
    await waitFor(() => live.events.find((e) => e.kind === "member.joined" && e.payload.userId === annaId));
    assert.equal((await send(anna, relizy.id, "теперь можно")).status, 201);
    live.socket.disconnect();
  });

  test("a private channel is invisible to outsiders until a member adds them", async () => {
    secret = (await call(owner, "POST", "/api/conversations", { name: `secret-${run}`, kind: "private", memberIds: [annaId] })).body;
    assert.equal(secret.kind, "private");
    assert.ok(secret.memberIds.includes(annaId));
    const dir = (await call(boris, "GET", "/api/conversations/browse")).body;
    assert.ok(!dir.some((c) => c.id === secret.id), "not in the directory");
    assert.equal((await call(boris, "GET", `/api/conversations/${secret.id}`)).status, 404);
    assert.equal((await call(boris, "POST", `/api/conversations/${secret.id}/join`, {})).status, 404);

    const added = await call(anna, "POST", `/api/conversations/${secret.id}/members`, { userIds: [borisId] });
    assert.ok(added.body.memberIds.includes(borisId), "any member can add people");
    assert.ok(conv(await boot(boris), secret.id));
  });

  test("only managers and admins remove people; #general keeps everyone", async () => {
    assert.equal((await call(anna, "DELETE", `/api/conversations/${secret.id}/members/${borisId}`)).status, 403);
    const res = await call(owner, "DELETE", `/api/conversations/${secret.id}/members/${borisId}`);
    assert.ok(!res.body.memberIds.includes(borisId));
    assert.equal((await call(boris, "GET", `/api/conversations/${secret.id}`)).status, 404);
    assert.equal((await call(owner, "DELETE", `/api/conversations/${general.id}/members/${borisId}`)).status, 403);
  });

  test("leaving: allowed for channels, not for #general", async () => {
    await call(boris, "POST", `/api/conversations/${relizy.id}/join`, {});
    assert.equal((await call(boris, "POST", `/api/conversations/${relizy.id}/leave`, {})).status, 204);
    assert.ok(!conv(await boot(boris), relizy.id));
    const msgs = (await call(owner, "GET", `/api/conversations/${relizy.id}/messages`)).body.messages;
    assert.ok(msgs.some((m) => m.subtype === "leave" && m.userId === borisId), "a 'left the channel' line is posted");
    assert.equal((await call(boris, "POST", `/api/conversations/${general.id}/leave`, {})).status, 403);
  });

  test("topic and purpose by any member; rename only by managers, names stay unique", async () => {
    const live = connect(owner, (await boot(owner)).lastEventId);
    await live.synced;
    const t = await call(anna, "PATCH", `/api/conversations/${relizy.id}`, { topic: "Релиз 2.15 в пятницу" });
    assert.equal(t.body.topic, "Релиз 2.15 в пятницу");
    await waitFor(() => live.events.find((e) => e.kind === "conversation.updated" && e.payload.topic === "Релиз 2.15 в пятницу"));
    await waitFor(() => live.events.find((e) => e.kind === "message.created" && e.payload.subtype === "topic"));

    assert.equal((await call(anna, "PATCH", `/api/conversations/${relizy.id}`, { name: `x-${run}` })).status, 403);
    const renamed = await call(owner, "PATCH", `/api/conversations/${relizy.id}`, { name: `${relName}-v2` });
    assert.equal(renamed.body.name, `${relName}-v2`);
    assert.equal((await call(owner, "PATCH", `/api/conversations/${relizy.id}`, { name: secret.name })).status, 409);
    live.socket.disconnect();
  });

  test("DMs: one conversation per set of people, shown to the other side after the first message", async () => {
    const a = (await call(anna, "POST", "/api/conversations/dm", { userIds: [borisId] })).body;
    assert.equal(a.kind, "dm");
    const b = (await call(boris, "POST", "/api/conversations/dm", { userIds: [annaId] })).body;
    assert.equal(b.id, a.id, "same pair → same DM");

    const dm2 = (await call(anna, "POST", "/api/conversations/dm", { userIds: [caraId] })).body;
    assert.ok(!conv(await boot(cara), dm2.id), "not shown before a message");
    await send(anna, dm2.id, "Привет, Кара!");
    const caraDm = conv(await boot(cara), dm2.id);
    assert.ok(caraDm, "shown after the first message");
    assert.equal(caraDm.unreadCount, 1);

    const group = (await call(anna, "POST", "/api/conversations/dm", { userIds: [borisId, caraId] })).body;
    assert.equal(group.kind, "group_dm");
    assert.equal(group.memberIds.length, 3);
    const self = (await call(anna, "POST", "/api/conversations/dm", { userIds: [] })).body;
    assert.deepEqual(self.memberIds, [annaId], "a DM with yourself for notes");
    const tooMany = Array.from({ length: 9 }, () => crypto.randomUUID());
    assert.equal((await call(anna, "POST", "/api/conversations/dm", { userIds: tooMany })).status, 400);
  });

  test("mentions: counted per person, @here only for those online, @channel for all", async () => {
    const borisLive = connect(boris, (await boot(boris)).lastEventId);
    await borisLive.synced; // boris в сети, cara — нет

    const direct = await send(anna, general.id, `<@${borisId}> глянь, пожалуйста`);
    assert.deepEqual(direct.body.mentions, [borisId]);
    await waitFor(() => borisLive.events.find((e) => e.kind === "message.created" && e.payload.id === direct.body.id));
    assert.equal(conv(await boot(boris), general.id).mentionCount, 1);

    const here = await send(anna, general.id, "<!here> созвон через 5 минут");
    assert.ok(here.body.mentions.includes(borisId));
    assert.ok(!here.body.mentions.includes(caraId), "offline people aren't pinged by @here");
    assert.ok(!here.body.mentions.includes(annaId), "never yourself");

    const all = await send(anna, general.id, "<!channel> релиз завтра");
    assert.ok(all.body.mentions.includes(caraId) && all.body.mentions.includes(borisId));
    assert.equal(conv(await boot(cara), general.id).mentionCount, 1);

    const outsider = await send(anna, relizy.id, `<@${caraId}> ты тут?`);
    assert.deepEqual(outsider.body.mentions, [], "people outside the channel aren't counted");

    const dm = conv(await boot(anna), (await call(anna, "POST", "/api/conversations/dm", { userIds: [borisId] })).body.id);
    assert.deepEqual((await send(anna, dm.id, "<!channel> тест")).body.mentions, [], "no @channel in DMs");

    const before = conv(await boot(boris), general.id);
    await call(boris, "POST", `/api/conversations/${general.id}/read`, { seq: before.latestSeq });
    assert.equal(conv(await boot(boris), general.id).mentionCount, 0);
    borisLive.socket.disconnect();
  });

  test("catch-up replays message events written before mentions existed", async () => {
    const since = (await boot(owner)).lastEventId;
    const sent = await send(owner, general.id, "сообщение из старого журнала");
    // Так выглядят события, записанные до M2: в payload нет mentions.
    const { default: pg } = await import("pg");
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      await db.query("update events set payload = payload - 'mentions' where kind = 'message.created' and payload->>'id' = $1", [sent.body.id]);
    } finally {
      await db.end();
    }
    const live = connect(owner, since);
    await live.synced;
    const replayed = await waitFor(() => live.events.find((e) => e.kind === "message.created" && e.payload.id === sent.body.id));
    assert.deepEqual(replayed.payload.mentions, []);
    live.socket.disconnect();
  });
});
