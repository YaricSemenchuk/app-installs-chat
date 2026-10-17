// M3: треды и сводки, подписки, правка и удаление, реакции, ссылки на сообщения.
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { DOMAIN, boot, call, closeSockets, connect, login, run, send, waitFor } from "./helpers.mjs";

const conv = (b, id) => b.conversations.find((c) => c.id === id);
const reply = (cookie, convId, parentId, text, alsoInChannel = false) =>
  call(cookie, "POST", `/api/conversations/${convId}/messages`, { clientMsgId: randomUUID(), text, parentId, alsoInChannel });
const feed = async (cookie, convId) => (await call(cookie, "GET", `/api/conversations/${convId}/messages?limit=100`)).body.messages;

async function sql(query, params = []) {
  const { default: pg } = await import("pg");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.end();
  }
}

describe("M3 threads, edits, deletes and reactions", () => {
  let owner, anna, boris, cara;
  let annaId, borisId, ownerId;
  let ch, secret;

  before(async () => {
    owner = await login(`owner@${DOMAIN}`);
    anna = await login(`anna3.${run}@${DOMAIN}`);
    boris = await login(`boris3.${run}@${DOMAIN}`);
    cara = await login(`cara3.${run}@${DOMAIN}`);
    ownerId = (await boot(owner)).me.id;
    annaId = (await boot(anna)).me.id;
    borisId = (await boot(boris)).me.id;
    ch = (await call(owner, "POST", "/api/conversations", { name: `m3-${run}`, memberIds: [annaId, borisId] })).body;
    secret = (await call(owner, "POST", "/api/conversations", { name: `m3-secret-${run}`, kind: "private", memberIds: [annaId] })).body;
  });
  after(closeSockets);

  test("replies live in the thread; the parent carries the summary; channel counters ignore them", async () => {
    const parent = (await send(owner, ch.id, "Обсудим релиз?")).body;
    const live = connect(boris, (await boot(boris)).lastEventId);
    await live.synced;
    const before = conv(await boot(boris), ch.id);

    const r1 = await reply(anna, ch.id, parent.id, `<@${borisId}> глянь, пожалуйста`);
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    assert.equal(r1.body.parentId, parent.id);
    assert.equal(r1.body.alsoInChannel, false);
    const summary = await waitFor(() => live.events.find((e) => e.kind === "thread.updated" && e.payload.parentId === parent.id));
    assert.equal(summary.payload.replyCount, 1);
    assert.deepEqual(summary.payload.replyUserIds, [annaId]);

    const inFeed = await feed(boris, ch.id);
    assert.ok(!inFeed.some((m) => m.id === r1.body.id), "a thread reply is not in the channel feed");
    const p = inFeed.find((m) => m.id === parent.id);
    assert.equal(p.replyCount, 1);
    assert.ok(p.lastReplyAt);
    const after = conv(await boot(boris), ch.id);
    assert.equal(after.unreadCount, before.unreadCount, "thread replies don't make the channel unread");
    assert.equal(after.mentionCount, before.mentionCount, "nor count as channel mentions");

    const page = (await call(boris, "GET", `/api/messages/${parent.id}/replies`)).body;
    assert.equal(page.parent.id, parent.id);
    assert.deepEqual(page.replies.map((m) => m.id), [r1.body.id]);
    assert.equal(page.subscribed, true, "a mentioned person follows the thread");
    assert.equal((await call(owner, "GET", `/api/messages/${parent.id}/replies`)).body.subscribed, true, "so does the parent's author");

    const broadcast = await reply(owner, ch.id, parent.id, "Итог: выкатываем в четверг", true);
    assert.ok((await feed(boris, ch.id)).some((m) => m.id === broadcast.body.id), "also-in-channel replies show in the feed");
    assert.equal(conv(await boot(boris), ch.id).unreadCount, before.unreadCount + 1);

    assert.equal((await reply(anna, ch.id, r1.body.id, "ответ на ответ")).status, 400, "threads are one level deep");
    assert.equal((await reply(anna, secret.id, parent.id, "не туда")).status, 400, "the parent must be in the same conversation");
    live.socket.disconnect();
  });

  test("unfollowing a thread sticks until you reply again", async () => {
    const parent = (await send(owner, ch.id, "Кто дежурит в выходные?")).body;
    await reply(anna, ch.id, parent.id, "я");
    const sub = await call(owner, "PUT", `/api/threads/${parent.id}/subscription`, { subscribed: false });
    assert.equal(sub.status, 204);
    await reply(boris, ch.id, parent.id, "я тоже");
    assert.equal((await call(owner, "GET", `/api/messages/${parent.id}/replies`)).body.subscribed, false);
    await reply(owner, ch.id, parent.id, "спасибо");
    assert.equal((await call(owner, "GET", `/api/messages/${parent.id}/replies`)).body.subscribed, true);
    assert.equal((await call(owner, "POST", `/api/threads/${parent.id}/read`, { seq: 1 })).status, 204);
  });

  test("editing: only the author, within the window, with mentions recounted", async () => {
    const m = (await send(anna, ch.id, "черновик")).body;
    const live = connect(boris, (await boot(boris)).lastEventId);
    await live.synced;
    const before = conv(await boot(boris), ch.id).mentionCount;

    assert.equal((await call(boris, "PATCH", `/api/messages/${m.id}`, { text: "чужое" })).status, 403);
    const edited = await call(anna, "PATCH", `/api/messages/${m.id}`, { text: `<@${borisId}> финальная версия` });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.ok(edited.body.editedAt);
    assert.deepEqual(edited.body.mentions, [borisId]);
    await waitFor(() => live.events.find((e) => e.kind === "message.updated" && e.payload.id === m.id));
    assert.equal(conv(await boot(boris), ch.id).mentionCount, before + 1, "a mention added by an edit counts");

    await call(anna, "PATCH", `/api/messages/${m.id}`, { text: "финальная версия" });
    assert.equal(conv(await boot(boris), ch.id).mentionCount, before, "and one removed by an edit stops counting");

    await sql("update workspace_settings set message_edit_window_minutes = 0");
    try {
      const late = await call(anna, "PATCH", `/api/messages/${m.id}`, { text: "поздно" });
      assert.equal(late.status, 403);
      assert.equal((await boot(anna)).workspace.messageEditWindowMinutes, 0);
    } finally {
      await sql("update workspace_settings set message_edit_window_minutes = null");
    }
    live.socket.disconnect();
  });

  test("deleting: the author or an admin; a parent with replies stays as a stub", async () => {
    const live = connect(boris, (await boot(boris)).lastEventId);
    await live.synced;
    const m = (await send(anna, ch.id, "удалю")).body;
    assert.equal((await call(boris, "DELETE", `/api/messages/${m.id}`)).status, 403);
    assert.equal((await call(owner, "DELETE", `/api/messages/${m.id}`)).status, 204, "admins delete anyone's messages");
    await waitFor(() => live.events.find((e) => e.kind === "message.deleted" && e.payload.id === m.id));
    assert.ok(!(await feed(boris, ch.id)).some((x) => x.id === m.id));
    assert.equal((await call(owner, "DELETE", `/api/messages/${m.id}`)).status, 204, "deleting twice is harmless");

    const parent = (await send(anna, ch.id, "вопрос с ответами")).body;
    const r = (await reply(boris, ch.id, parent.id, "ответ")).body;
    assert.equal((await call(anna, "DELETE", `/api/messages/${parent.id}`)).status, 204);
    const stub = (await feed(boris, ch.id)).find((x) => x.id === parent.id);
    assert.ok(stub?.deleted && stub.text === "" && stub.replyCount === 1, "the stub keeps the thread reachable");
    assert.equal((await call(boris, "GET", `/api/messages/${parent.id}/replies`)).body.replies.length, 1);
    assert.equal((await reply(boris, ch.id, parent.id, "ещё")).status, 400, "no new replies to a deleted message");

    assert.equal((await call(boris, "DELETE", `/api/messages/${r.id}`)).status, 204);
    const summary = await waitFor(() =>
      live.events.find((e) => e.kind === "thread.updated" && e.payload.parentId === parent.id && e.payload.replyCount === 0),
    );
    assert.deepEqual(summary.payload.replyUserIds, []);
    assert.ok(!(await feed(boris, ch.id)).some((x) => x.id === parent.id), "an empty stub leaves the feed");
    live.socket.disconnect();
  });

  test("reactions: one per person and emoji, members only, live", async () => {
    const m = (await send(owner, ch.id, "Голосуем")).body;
    const live = connect(boris, (await boot(boris)).lastEventId);
    await live.synced;
    const react = (cookie, emoji) => call(cookie, "POST", `/api/messages/${m.id}/reactions`, { emoji });

    assert.equal((await react(anna, "+1")).status, 204);
    assert.equal((await react(anna, "+1")).status, 204, "the same reaction twice is a no-op");
    await react(boris, "+1");
    await react(owner, "eyes");
    let got = (await feed(boris, ch.id)).find((x) => x.id === m.id);
    assert.deepEqual(got.reactions, [
      { emoji: "+1", userIds: [annaId, borisId] },
      { emoji: "eyes", userIds: [ownerId] },
    ]);
    await waitFor(() => live.events.filter((e) => e.kind === "reaction.added" && e.payload.messageId === m.id).length === 3);
    assert.equal(
      live.events.filter((e) => e.kind === "reaction.added" && e.payload.userId === annaId && e.payload.messageId === m.id).length,
      1,
    );

    assert.equal((await call(anna, "DELETE", `/api/messages/${m.id}/reactions/${encodeURIComponent("+1")}`)).status, 204);
    got = (await feed(boris, ch.id)).find((x) => x.id === m.id);
    assert.deepEqual(got.reactions[0], { emoji: "+1", userIds: [borisId] });
    await waitFor(() => live.events.find((e) => e.kind === "reaction.removed" && e.payload.messageId === m.id));

    assert.equal((await react(anna, "Плохо!")).status, 400);
    assert.equal((await react(cara, "+1")).status, 403, "reading a public channel isn't enough to react");

    for (let i = 0; i < 48; i++) await react(owner, `e${i}`);
    assert.equal((await react(owner, "e48")).status, 400, "at most 50 different reactions per message");
    assert.equal((await react(anna, "e0")).status, 204, "adding to an existing one is fine");

    const gone = (await send(anna, ch.id, "сейчас удалю")).body;
    await call(anna, "DELETE", `/api/messages/${gone.id}`);
    assert.equal((await call(boris, "POST", `/api/messages/${gone.id}/reactions`, { emoji: "+1" })).status, 400);
    live.socket.disconnect();
  });

  test("permalinks resolve the conversation and thread; outsiders get 404", async () => {
    const parent = (await send(owner, ch.id, "ссылка на тред")).body;
    const r = (await reply(anna, ch.id, parent.id, "ответ по ссылке")).body;
    const link = (await call(boris, "GET", `/api/messages/${r.id}/link`)).body;
    assert.deepEqual(link, { conversationId: ch.id, messageId: r.id, parentId: parent.id, seq: r.seq });

    const hidden = (await send(owner, secret.id, "только для своих")).body;
    assert.equal((await call(anna, "GET", `/api/messages/${hidden.id}/link`)).status, 200);
    assert.equal((await call(boris, "GET", `/api/messages/${hidden.id}/link`)).status, 404);
    assert.equal((await call(boris, "GET", `/api/messages/${hidden.id}/replies`)).status, 404);
    assert.equal((await call(boris, "POST", `/api/messages/${hidden.id}/reactions`, { emoji: "+1" })).status, 404);
  });
});
