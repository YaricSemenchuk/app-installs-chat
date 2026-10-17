// M4: загрузка файлов, миниатюры, доступ, вид «Файлы», удаление, поиск по сообщениям.
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { BASE, DOMAIN, boot, call, closeSockets, connect, login, run, send, waitFor } from "./helpers.mjs";

const putRaw = async (cookie, path, body) => {
  const res = await fetch(BASE + path, { method: "PUT", headers: { cookie, "content-type": "application/octet-stream" }, body });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const get = (cookie, path) => fetch(BASE + path, { headers: { cookie }, redirect: "manual" });

async function upload(cookie, name, bytes, mimetype) {
  const ticket = await call(cookie, "POST", "/api/files", { name, size: bytes.length, mimetype });
  assert.equal(ticket.status, 201, JSON.stringify(ticket.body));
  const done = await putRaw(cookie, ticket.body.uploadUrl, bytes);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return done.body;
}

const post = (cookie, convId, body) => call(cookie, "POST", `/api/conversations/${convId}/messages`, { clientMsgId: randomUUID(), ...body });
const search = async (cookie, q, extra = "") =>
  (await call(cookie, "GET", `/api/search/messages?q=${encodeURIComponent(q)}${extra}`)).body;

describe("M4 files and search", () => {
  let owner, anna, boris;
  let annaId, borisId;
  let ch, secret, png;

  before(async () => {
    owner = await login(`owner@${DOMAIN}`);
    anna = await login(`anna4.${run}@${DOMAIN}`);
    boris = await login(`boris4.${run}@${DOMAIN}`);
    annaId = (await boot(anna)).me.id;
    borisId = (await boot(boris)).me.id;
    ch = (await call(owner, "POST", "/api/conversations", { name: `m4-${run}`, memberIds: [annaId, borisId] })).body;
    secret = (await call(owner, "POST", "/api/conversations", { name: `m4-secret-${run}`, kind: "private", memberIds: [annaId] })).body;
    png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#4262ff" } }).png().toBuffer();
  });
  after(closeSockets);

  test("an image upload gets its size and 360/720 thumbnails; the message carries it", async () => {
    const file = await upload(anna, "Макет баннера.png", png, "image/png");
    assert.equal(file.status, "ready");
    assert.deepEqual(file.image, { width: 1200, height: 800, thumbs: [360, 720] });

    const thumb = await get(anna, `/api/files/${file.id}/thumb/360`);
    assert.equal(thumb.status, 200, "the uploader sees it before sending");
    const meta = await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, 360);
    assert.equal((await get(boris, `/api/files/${file.id}/thumb/360`)).status, 404, "nobody else sees it until it's sent");

    const live = connect(boris, (await boot(boris)).lastEventId);
    await live.synced;
    const msg = await post(anna, ch.id, { text: "", fileIds: [file.id] });
    assert.equal(msg.status, 201, JSON.stringify(msg.body));
    assert.equal(msg.body.files[0].id, file.id);
    const ev = await waitFor(() => live.events.find((e) => e.kind === "message.created" && e.payload.id === msg.body.id));
    assert.equal(ev.payload.files[0].name, "Макет баннера.png");

    const inline = await get(boris, `/api/files/${file.id}/download?inline=1`);
    assert.equal(inline.status, 200);
    assert.equal(inline.headers.get("content-type"), "image/png");
    assert.match(inline.headers.get("content-disposition"), /^inline;/);
    assert.equal(inline.headers.get("x-content-type-options"), "nosniff");
    const attachment = await get(boris, `/api/files/${file.id}/download`);
    assert.match(attachment.headers.get("content-disposition"), /^attachment;.*filename\*=UTF-8''%D0%9C%D0%B0%D0%BA%D0%B5%D1%82/);
    assert.equal(Buffer.from(await attachment.arrayBuffer()).length, png.length);

    assert.equal((await post(anna, ch.id, { text: "ещё раз", fileIds: [file.id] })).status, 400, "a file is sent once");
    live.socket.disconnect();
  });

  test("only readers of a conversation get its files", async () => {
    const file = await upload(owner, "секрет.txt", Buffer.from("только для своих"), "text/plain");
    await post(owner, secret.id, { text: "тут", fileIds: [file.id] });
    assert.equal((await get(anna, `/api/files/${file.id}/download`)).status, 200);
    assert.equal((await get(boris, `/api/files/${file.id}/download`)).status, 404);
    assert.equal((await call(boris, "POST", `/api/conversations/${ch.id}/messages`, { clientMsgId: randomUUID(), text: "", fileIds: [file.id] })).status, 400, "nor attach someone else's file");
  });

  test("sizes are enforced on the way in", async () => {
    const big = await call(anna, "POST", "/api/files", { name: "фильм.mov", size: 100 * 1024 * 1024 + 1, mimetype: "video/quicktime" });
    assert.equal(big.status, 400);

    const ticket = (await call(anna, "POST", "/api/files", { name: "a.bin", size: 10 })).body;
    assert.equal((await putRaw(boris, ticket.uploadUrl, Buffer.alloc(10))).status, 404, "only the uploader uploads");
    assert.equal((await putRaw(anna, ticket.uploadUrl, Buffer.alloc(11))).status, 400, "content-length must match");
    const chunked = await fetch(BASE + ticket.uploadUrl, {
      method: "PUT",
      headers: { cookie: anna, "content-type": "application/octet-stream" },
      body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20)); c.close(); } }),
      duplex: "half",
    });
    assert.equal(chunked.status, 413, "more bytes than declared are cut off");
    assert.equal((await putRaw(anna, ticket.uploadUrl, Buffer.alloc(10))).status, 200, "a retry after a failure works");
    assert.equal((await putRaw(anna, ticket.uploadUrl, Buffer.alloc(10))).status, 409, "a finished file can't be overwritten");
  });

  test("something that only claims to be an image is served as a download", async () => {
    const fake = await upload(anna, "evil.png", Buffer.from("<html><script>alert(1)</script></html>"), "image/png");
    assert.equal(fake.image, null);
    await post(anna, ch.id, { text: "картинка?", fileIds: [fake.id] });
    const res = await get(boris, `/api/files/${fake.id}/download?inline=1`);
    assert.equal(res.headers.get("content-type"), "application/octet-stream");
    assert.match(res.headers.get("content-disposition"), /^attachment;/);
    assert.equal((await get(boris, `/api/files/${fake.id}/thumb/360`)).status, 404);
  });

  test("the files view lists what's shared in my conversations, with filters and paging", async () => {
    const list = (cookie, qs = "") => call(cookie, "GET", `/api/files${qs}`).then((r) => r.body);
    const mine = await list(boris);
    assert.ok(mine.items.some((i) => i.file.name === "Макет баннера.png"));
    assert.ok(!mine.items.some((i) => i.file.name === "секрет.txt"), "private channel files stay private");
    assert.ok((await list(boris, "?type=images")).items.every((i) => i.file.image !== null));
    assert.ok((await list(boris, "?type=documents")).items.every((i) => i.file.image === null));
    assert.deepEqual((await list(boris, `?query=${encodeURIComponent("макет")}`)).items.map((i) => i.file.name), ["Макет баннера.png"]);
    assert.equal((await list(boris, "?mine=true")).items.length, 0);

    // Страницы по одному файлу: граница проходит и внутри сообщения с несколькими файлами — ничего не теряется.
    const pair = [await upload(anna, "раз.txt", Buffer.from("1"), "text/plain"), await upload(anna, "два.txt", Buffer.from("2"), "text/plain")];
    await post(anna, ch.id, { text: "два файла", fileIds: pair.map((f) => f.id) });
    const all = (await list(anna, "?limit=100")).items.map((i) => i.file.id);
    assert.deepEqual(all.slice(0, 2), pair.map((f) => f.id), "files of one message keep their order");
    const paged = [];
    let cursor = "";
    for (let i = 0; i < 20; i++) {
      const page = await list(anna, `?limit=1${cursor ? `&before=${cursor}` : ""}`);
      paged.push(...page.items.map((x) => x.file.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    assert.deepEqual(paged, all);
  });

  test("deleting a file updates its message everywhere and stops downloads", async () => {
    const file = await upload(anna, "черновик.pdf", Buffer.from("%PDF-1.4 test"), "application/pdf");
    const msg = (await post(anna, ch.id, { text: "отчёт", fileIds: [file.id] })).body;
    const live = connect(boris, (await boot(boris)).lastEventId);
    await live.synced;
    assert.equal((await call(boris, "DELETE", `/api/files/${file.id}`)).status, 403);
    assert.equal((await call(anna, "DELETE", `/api/files/${file.id}`)).status, 204);
    const ev = await waitFor(() => live.events.find((e) => e.kind === "message.updated" && e.payload.id === msg.id));
    assert.equal(ev.payload.files[0].deleted, true);
    assert.equal((await get(boris, `/api/files/${file.id}/download`)).status, 404);
    live.socket.disconnect();
  });

  test("search: morphology, phrases, exclusions, file names, filters, paging and permissions", async () => {
    const tag = run.replace(/[^a-z0-9]/g, "");
    const a = (await send(anna, ch.id, `Релизы ${tag} выкатываем в четверг`)).body;
    const b = (await send(owner, ch.id, `Релиз ${tag} отложили, ждём ревью`)).body;
    await send(owner, secret.id, `Секретный релиз ${tag}`);
    const pdf = await upload(anna, `${tag}-отчёт.pdf`, Buffer.from("%PDF-1.4"), "application/pdf");
    const withFile = (await post(anna, ch.id, { text: "", fileIds: [pdf.id] })).body;

    const all = await search(boris, `релиз ${tag}`);
    assert.deepEqual(all.hits.map((h) => h.message.id), [b.id, a.id], "both word forms, newest first, no private channel");
    assert.ok(all.hits[1].highlights.includes("релизы"));

    assert.deepEqual((await search(anna, `релиз ${tag}`)).hits.length, 3, "members see their private channel too");
    assert.deepEqual((await search(boris, `"${tag} отложили"`)).hits.map((h) => h.message.id), [b.id]);
    // Сообщение с файлом «<тег>-отчёт.pdf» тоже подходит: тег в имени есть, «ревью» нет.
    assert.deepEqual((await search(boris, `${tag} -ревью`)).hits.map((h) => h.message.id), [withFile.id, a.id]);
    // «-» в запросе — исключение слова, поэтому имя файла ищем через пробел.
    assert.deepEqual((await search(boris, `${tag} отчёт`)).hits.map((h) => h.message.id), [withFile.id], "file names match too");
    assert.deepEqual((await search(boris, `релиз ${tag}`, `&userId=${annaId}`)).hits.map((h) => h.message.id), [a.id]);

    const page1 = await search(boris, `релиз ${tag}`, "&limit=1");
    assert.equal(page1.hits[0].message.id, b.id);
    const page2 = await search(boris, `релиз ${tag}`, `&limit=1&before=${page1.nextCursor}`);
    assert.equal(page2.hits[0].message.id, a.id);
    assert.equal(page2.nextCursor, null);

    assert.equal((await call(boris, "GET", "/api/search/messages?q=")).status, 400);
    assert.deepEqual((await search(boris, "и")).hits, [], "a stop word alone finds nothing, without an error");
    assert.ok(borisId);
  });
});
