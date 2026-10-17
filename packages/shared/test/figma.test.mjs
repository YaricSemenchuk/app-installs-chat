// Ссылки на Figma в задачах и сообщениях. Запуск: npm test -w @teamchat/shared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TaskSourceInput, extractLinks, figmaFileUrl, parseFigmaUrl } from "../dist/index.js";

test("figma links: file, frame, branch, FigJam", () => {
  assert.deepEqual(parseFigmaUrl("https://www.figma.com/design/AbCdEf0123456789/Ads-—-Campaigns?node-id=1813-122837&t=xyz"), {
    url: "https://www.figma.com/design/AbCdEf0123456789/Ads-%E2%80%94-Campaigns?node-id=1813-122837&t=xyz",
    fileKey: "AbCdEf0123456789",
    nodeId: "1813:122837",
  });
  assert.equal(parseFigmaUrl("https://figma.com/file/AbCdEf0123456789/Title?node-id=0%3A1").nodeId, "0:1");
  assert.equal(parseFigmaUrl("https://www.figma.com/design/AbCdEf0123456789/branch/BrAnCh01234567/Title").fileKey, "BrAnCh01234567");
  assert.equal(parseFigmaUrl("https://www.figma.com/board/AbCdEf0123456789/Retro").nodeId, null);
  assert.equal(parseFigmaUrl("https://www.figma.com/design/AbCdEf0123456789?node-id=I5-6;7-8").nodeId, null);
});

test("figma links: not figma or not a file", () => {
  assert.equal(parseFigmaUrl("http://www.figma.com/design/AbCdEf0123456789/x"), null);
  assert.equal(parseFigmaUrl("https://figma.com.evil.test/design/AbCdEf0123456789/x"), null);
  assert.equal(parseFigmaUrl("https://www.figma.com/community/file/123"), null);
  assert.equal(parseFigmaUrl("https://www.figma.com/design/short/x"), null);
  assert.equal(parseFigmaUrl("не ссылка"), null);
  assert.equal(figmaFileUrl("AbCdEf0123456789", "12:34"), "https://www.figma.com/file/AbCdEf0123456789?node-id=12-34");
});

test("links in a message, without code and repeats", () => {
  const text = "макет <https://www.figma.com/design/AbCdEf0123456789/a|вот>, и ещё https://example.com/x.\n`https://www.figma.com/design/ZZZZZZZZZZ/b`\n- https://example.com/x";
  assert.deepEqual(extractLinks(text), ["https://www.figma.com/design/AbCdEf0123456789/a", "https://example.com/x"]);
});

test("task source input", () => {
  assert.deepEqual(TaskSourceInput.parse({ jql: "  ", figmaFiles: [] }), { jql: null, figmaFiles: [] });
  assert.equal(TaskSourceInput.parse({ jql: " project = DEV " }).jql, "project = DEV");
  assert.ok(!TaskSourceInput.safeParse({ jql: null, figmaFiles: ["https://example.com"] }).success);
});
