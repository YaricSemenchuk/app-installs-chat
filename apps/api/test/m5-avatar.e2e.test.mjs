// Фото профиля: из своей загруженной картинки, квадрат 256 px, видно всем вошедшим, можно убрать.
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { BASE, DOMAIN, boot, call, closeSockets, connect, login, run, waitFor } from "./helpers.mjs";

const get = (cookie, path) => fetch(BASE + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });

async function upload(cookie, name, bytes, mimetype) {
  const ticket = (await call(cookie, "POST", "/api/files", { name, size: bytes.length, mimetype })).body;
  const res = await fetch(BASE + ticket.uploadUrl, { method: "PUT", headers: { cookie, "content-type": "application/octet-stream" }, body: bytes });
  assert.equal(res.status, 200);
  return res.json();
}

describe("profile photos", () => {
  let anna, boris, annaId, photo;

  before(async () => {
    anna = await login(`anna6.${run}@${DOMAIN}`);
    boris = await login(`boris6.${run}@${DOMAIN}`);
    annaId = (await boot(anna)).me.id;
    // Не квадратная картинка: аватар должен стать квадратом.
    photo = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#4262ff" } }).jpeg().toBuffer();
  });
  after(closeSockets);

  test("an uploaded picture becomes a 256 px square everyone signed in can see", async () => {
    const live = connect(boris, (await boot(boris)).lastEventId);
    await live.synced;
    const file = await upload(anna, "я.jpg", photo, "image/jpeg");
    const res = await call(anna, "PATCH", "/api/me/profile", { avatarFileId: file.id });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const url = res.body.avatarUrl;
    assert.match(url, new RegExp(`^/api/users/${annaId}/avatar\\?v=[0-9a-f]{12}$`));

    const ev = await waitFor(() => live.events.find((e) => e.kind === "user.updated" && e.payload.id === annaId && e.payload.avatarUrl === url));
    assert.ok(ev);
    const img = await get(boris, url);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/webp");
    assert.match(img.headers.get("cache-control"), /immutable/);
    const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
    assert.deepEqual([meta.width, meta.height], [256, 256]);

    assert.equal((await get(null, url)).status, 401, "not for strangers");
    assert.equal((await get(anna, `/api/files/${file.id}/download`)).status, 404, "the source file is gone");
    live.socket.disconnect();
  });

  test("only your own unsent pictures can become a photo", async () => {
    const text = await upload(anna, "notes.txt", Buffer.from("hello"), "text/plain");
    assert.equal((await call(anna, "PATCH", "/api/me/profile", { avatarFileId: text.id })).status, 400);
    const borisPic = await upload(boris, "кот.jpg", photo, "image/jpeg");
    assert.equal((await call(anna, "PATCH", "/api/me/profile", { avatarFileId: borisPic.id })).status, 400);
    const general = (await boot(anna)).conversations.find((c) => c.isGeneral);
    const sent = await upload(anna, "в чат.jpg", photo, "image/jpeg");
    await call(anna, "POST", `/api/conversations/${general.id}/messages`, { clientMsgId: randomUUID(), text: "", fileIds: [sent.id] });
    assert.equal((await call(anna, "PATCH", "/api/me/profile", { avatarFileId: sent.id })).status, 400, "a shared file stays in the chat");
    assert.ok((await boot(anna)).me.avatarUrl, "the old photo is still there after failed attempts");
  });

  test("a new photo replaces the old one; null removes it", async () => {
    const before = (await boot(anna)).me.avatarUrl;
    const next = await upload(anna, "новое.png", await sharp(photo).png().toBuffer(), "image/png");
    const changed = (await call(anna, "PATCH", "/api/me/profile", { avatarFileId: next.id })).body.avatarUrl;
    assert.notEqual(changed, before, "a new photo gets a new address");
    assert.equal((await get(boris, before)).status, 200, "the old address now serves the current photo");

    const removed = await call(anna, "PATCH", "/api/me/profile", { avatarFileId: null });
    assert.equal(removed.body.avatarUrl, null);
    assert.equal((await get(boris, changed)).status, 404);
  });

  test("a photo can be set during onboarding", async () => {
    const fresh = await login(`fresh6.${run}@${DOMAIN}`);
    assert.equal((await boot(fresh)).me.onboarded, false);
    const pic = await upload(fresh, "аватар.webp", await sharp(photo).webp().toBuffer(), "image/webp");
    const res = await call(fresh, "POST", "/api/me/onboarding", { displayName: "Свежий", avatarFileId: pic.id });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.avatarUrl);
    assert.equal((await get(boris, res.body.avatarUrl)).status, 200);
  });
});
