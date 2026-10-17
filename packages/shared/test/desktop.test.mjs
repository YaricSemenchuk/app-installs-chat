// Версия установщика из имени файла: подставляется в форму загрузки. Запуск: npm test -w @teamchat/shared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DesktopVersion, versionFromName } from "../dist/index.js";

test("version from an installer name", () => {
  assert.equal(versionFromName("appinstallschat-1.0.2-mac.dmg"), "1.0.2");
  assert.equal(versionFromName("appinstallschat-12.3.40-win.exe"), "12.3.40");
  assert.equal(versionFromName("AppInstalls Chat Setup 2.1.0.exe"), "2.1.0");
  assert.equal(versionFromName("installer.dmg"), null);
  assert.ok(DesktopVersion.safeParse("1.0.2").success);
  assert.ok(!DesktopVersion.safeParse("1.0").success);
  assert.ok(!DesktopVersion.safeParse("1.0.2-beta").success);
});
