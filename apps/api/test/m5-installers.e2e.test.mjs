// Установщики приложения: администратор загружает .dmg и .exe, вошедшие скачивают, новая версия заменяет старую.
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { BASE, DOMAIN, call, closeSockets, login, run } from "./helpers.mjs";

// Похожие на настоящие: у .dmg в конце 512-байтный блок «koly», .exe начинается с «MZ».
const dmg = () => Buffer.concat([randomBytes(5000), Buffer.from("koly"), Buffer.alloc(508)]);
const exe = () => Buffer.concat([Buffer.from("MZ"), randomBytes(3000)]);

const put = (cookie, platform, bytes, name, version) =>
  fetch(`${BASE}/api/admin/desktop/${platform}?${new URLSearchParams({ name, version })}`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/octet-stream" },
    body: bytes,
  });
const get = (cookie, path) => fetch(BASE + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });
const stored = (platform) => readdirSync(join(process.env.STORAGE_DIR, "desktop", platform));

describe("desktop installers", () => {
  let owner, anna, firstMac;

  before(async () => {
    owner = await login(`owner@${DOMAIN}`);
    anna = await login(`anna7.${run}@${DOMAIN}`);
  });
  after(closeSockets);

  test("an admin uploads, everyone signed in sees and downloads", async () => {
    assert.equal((await call(null, "GET", "/api/desktop")).status, 401, "not for strangers");
    assert.deepEqual((await call(anna, "GET", "/api/desktop")).body, { mac: null, win: null });

    firstMac = dmg();
    assert.equal((await put(anna, "mac", firstMac, "PromobileChat-1.0.2-mac.dmg", "1.0.2")).status, 403, "members cannot upload");
    const res = await put(owner, "mac", firstMac, "PromobileChat-1.0.2-mac.dmg", "1.0.2");
    assert.equal(res.status, 200, await res.clone().text());
    const mac = await res.json();
    assert.equal(mac.platform, "mac");
    assert.equal(mac.version, "1.0.2");
    assert.equal(mac.size, firstMac.length);
    assert.equal(mac.url, "/api/desktop/mac/download");

    const info = (await call(anna, "GET", "/api/desktop")).body;
    assert.equal(info.mac.version, "1.0.2");
    assert.equal(info.win, null);

    const file = await get(anna, mac.url);
    assert.equal(file.status, 200);
    assert.match(file.headers.get("content-disposition"), /^attachment; filename="PromobileChat-1\.0\.2-mac\.dmg"/);
    assert.ok(Buffer.from(await file.arrayBuffer()).equals(firstMac));
    assert.equal((await get(null, mac.url)).status, 401);
    assert.equal((await get(anna, "/api/desktop/linux/download")).status, 404);
  });

  test("only a real installer of the right kind", async () => {
    assert.equal((await put(owner, "mac", dmg(), "PromobileChat.zip", "1.0.9")).status, 400, "extension");
    assert.equal((await put(owner, "mac", exe(), "PromobileChat-1.0.9-mac.dmg", "1.0.9")).status, 400, "an .exe renamed to .dmg");
    assert.equal((await put(owner, "win", dmg(), "PromobileChat-1.0.9-win.exe", "1.0.9")).status, 400, "a .dmg renamed to .exe");
    assert.equal((await put(owner, "mac", dmg(), "PromobileChat-1.0-mac.dmg", "1.0")).status, 400, "version");

    // Заявленный размер больше лимита — отказ сразу, тело не ждём.
    const status = await new Promise((resolve, reject) => {
      const url = new URL(`/api/admin/desktop/mac?name=big.dmg&version=1.0.9`, BASE);
      const req = request(url, { method: "PUT", headers: { cookie: owner, "content-type": "application/octet-stream", "content-length": String(600 * 1024 * 1024) } }, (res) => {
        res.resume();
        resolve(res.statusCode);
        req.destroy();
      });
      req.on("error", reject);
      req.flushHeaders();
    });
    assert.equal(status, 413);

    assert.equal((await call(anna, "GET", "/api/desktop")).body.mac.version, "1.0.2", "the uploaded build is untouched");
    assert.deepEqual(stored("mac").length, 1, "rejected uploads leave no files behind");
  });

  test("a new version replaces the old one; delete removes it", async () => {
    const win = await put(owner, "win", exe(), "PromobileChat-1.0.2-win.exe", "1.0.2");
    assert.equal(win.status, 200);
    const next = dmg();
    assert.equal((await put(owner, "mac", next, "PromobileChat-1.0.3-mac.dmg", "1.0.3")).status, 200);
    const info = (await call(anna, "GET", "/api/desktop")).body;
    assert.deepEqual([info.mac.version, info.win.version], ["1.0.3", "1.0.2"]);
    assert.ok(Buffer.from(await (await get(anna, info.mac.url)).arrayBuffer()).equals(next));
    assert.equal(stored("mac").length, 1, "the old build is deleted from storage");

    assert.equal((await call(anna, "DELETE", "/api/admin/desktop/mac")).status, 403);
    assert.equal((await call(owner, "DELETE", "/api/admin/desktop/mac")).status, 204);
    assert.equal((await call(anna, "GET", "/api/desktop")).body.mac, null);
    assert.equal((await get(anna, "/api/desktop/mac/download")).status, 404);
    assert.equal(stored("mac").length, 0);
  });
});
