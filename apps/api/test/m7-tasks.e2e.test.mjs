// M7: задачи из Jira и макеты из Figma. Обе системы здесь поддельные: отвечают на те вызовы REST API,
// которые делает сервер, проверяют токены и считают запросы, чтобы было видно кэш.
import { createServer } from "node:http";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { BASE, DOMAIN, boot, call, closeSockets, connect, login, run, send, waitFor } from "./helpers.mjs";

const JIRA_PORT = Number(process.env.E2E_JIRA_PORT);
const FIGMA_PORT = Number(process.env.E2E_FIGMA_PORT);
const JIRA_AUTH = `Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64")}`;
const FILE = "FiLeKeY0123456789";
const NOACCESS = "NoAccess0123456789";
const FRAME_URL = `https://www.figma.com/design/${FILE}/Ads-Campaigns?node-id=1-2&t=abc`;

const jiraLog = [];
const figmaLog = [];
const accounts = new Map(); // почта → { accountId, showEmail }
const PRIORITIES = {
  Highest: { id: "1", name: "Highest", iconUrl: `http://localhost:${JIRA_PORT}/images/icons/priorities/highest.svg` },
  High: { id: "2", name: "High", iconUrl: `http://localhost:${JIRA_PORT}/images/icons/priorities/high.svg` },
  Medium: { id: "3", name: "Medium", iconUrl: `http://localhost:${JIRA_PORT}/images/icons/priorities/medium.svg` },
};
let issues = [];

const user = (accountId, name, email) => ({
  accountId,
  accountType: "atlassian",
  active: true,
  displayName: name,
  ...(email ? { emailAddress: email } : {}),
  avatarUrls: { "48x48": `https://avatar.example/${accountId}.png` },
});

const issue = (key, priority, status, category, assignee, extra = {}) => ({
  key,
  fields: {
    summary: `Задача ${key}`,
    status: { name: status, statusCategory: { key: category } },
    priority: PRIORITIES[priority],
    assignee,
    issuetype: { name: "Задача" },
    duedate: null,
    updated: "2026-10-17T09:00:00.000+0000",
    description: null,
    ...extra,
  },
});

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

// Как Jira: project = X AND statusCategory != Done, assignee = "id"; ORDER BY priority DESC — от наивысшего.
function searchJira(jql) {
  const project = jql.match(/project\s*=\s*([A-Z]+)/)?.[1];
  const assignee = jql.match(/assignee\s*=\s*"([^"]+)"/)?.[1];
  if (project && !["DEV", "BIG"].includes(project)) return { error: `The value '${project}' does not exist for the field 'project'.` };
  let found = issues.filter((i) => (!project || i.key.startsWith(`${project}-`)) && (!assignee || i.fields.assignee?.accountId === assignee));
  if (/statusCategory\s*!=\s*Done/i.test(jql)) found = found.filter((i) => i.fields.status.statusCategory.key !== "done");
  const rank = (i) => Number(i.fields.priority?.id ?? 9);
  return { found: [...found].sort((a, b) => rank(a) - rank(b)) };
}

const jira = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://jira");
    jiraLog.push({ method: req.method, path: url.pathname, query: url.search, body: body ? JSON.parse(body) : null });
    if (req.headers.authorization !== JIRA_AUTH) return json(res, 401, { errorMessages: ["Unauthorized"] });
    if (req.method === "POST" && url.pathname === "/rest/api/3/search/jql") {
      const { jql, maxResults, nextPageToken } = JSON.parse(body);
      const result = searchJira(jql);
      if (result.error) return json(res, 400, { errorMessages: [result.error] });
      const start = nextPageToken ? Number(nextPageToken) : 0;
      const page = result.found.slice(start, start + maxResults);
      const next = start + page.length < result.found.length ? String(start + page.length) : undefined;
      return json(res, 200, { issues: page, ...(next ? { nextPageToken: next } : { isLast: true }) });
    }
    if (url.pathname === "/rest/api/3/user/search") {
      const a = accounts.get(url.searchParams.get("query"));
      return json(res, 200, a ? [user(a.accountId, a.name, a.showEmail ? url.searchParams.get("query") : undefined)] : []);
    }
    if (url.pathname === "/rest/api/3/project/search") {
      return json(res, 200, { values: [{ key: "DEV", name: "Development", avatarUrls: { "48x48": "https://avatar.example/dev.png" } }] });
    }
    json(res, 404, { errorMessages: ["Not found"] });
  });
});

let png;
const figma = createServer((req, res) => {
  const url = new URL(req.url, "http://figma");
  figmaLog.push(url.pathname + url.search);
  if (url.pathname.startsWith("/img/")) {
    res.setHeader("content-type", "image/png");
    return res.end(png);
  }
  if (req.headers["x-figma-token"] !== process.env.FIGMA_TOKEN) return json(res, 403, { status: 403, err: "Invalid token" });
  const m = url.pathname.match(/^\/v1\/(files|images)\/([A-Za-z0-9]+)(\/[a-z]+)?$/);
  if (!m) return json(res, 404, { status: 404, err: "Not found" });
  const [, kind, key, sub] = m;
  if (key === NOACCESS) return json(res, 403, { status: 403, err: "Forbidden" });
  if (key !== FILE) return json(res, 404, { status: 404, err: "Not found" });
  if (kind === "images") return json(res, 200, { err: null, images: { [url.searchParams.get("ids")]: `http://localhost:${FIGMA_PORT}/img/frame.png` } });
  if (sub === "/meta") {
    return json(res, 200, { file: { name: "Ads — Campaigns", thumbnail_url: `http://localhost:${FIGMA_PORT}/img/thumb.png`, last_touched_at: "2026-10-16T12:00:00Z" } });
  }
  if (sub === "/nodes") {
    const id = url.searchParams.get("ids");
    return json(res, 200, {
      name: "Ads — Campaigns",
      lastModified: "2026-10-16T12:00:00Z",
      nodes: { [id]: { document: { id, name: "Campaigns list", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 } } } },
    });
  }
  if (sub === "/comments") {
    return json(res, 200, {
      comments: [
        { id: "101", parent_id: "", message: "Отступ у кнопки 16, не 12", created_at: "2026-10-16T10:00:00Z", resolved_at: null, user: { handle: "Designer", img_url: "https://avatar.example/d.png" }, client_meta: { node_id: "1:2", node_offset: { x: 1, y: 2 } } },
        { id: "102", parent_id: "101", message: "Поправлю", created_at: "2026-10-16T11:00:00Z", resolved_at: null, user: { handle: "Dev" } },
        { id: "103", parent_id: "", message: "Уже решено", created_at: "2026-10-16T09:00:00Z", resolved_at: "2026-10-16T09:30:00Z", user: { handle: "Designer" }, client_meta: { x: 1, y: 2 } },
      ],
    });
  }
  json(res, 404, { status: 404, err: "Not found" });
});

describe("M7 tasks from Jira and Figma", () => {
  let anna, boris, carl, annaId, borisId, channel, secret, borisLive, borisTasks;

  before(async () => {
    png = await sharp({ create: { width: 1440, height: 900, channels: 3, background: "#4262ff" } }).png().toBuffer();
    await Promise.all([new Promise((r) => jira.listen(JIRA_PORT, r)), new Promise((r) => figma.listen(FIGMA_PORT, r))]);
    const annaEmail = `anna9.${run}@${DOMAIN}`;
    const borisEmail = `boris9.${run}@${DOMAIN}`;
    anna = await login(annaEmail);
    boris = await login(borisEmail);
    carl = await login(`carl9.${run}@${DOMAIN}`);
    annaId = (await boot(anna)).me.id;
    borisId = (await boot(boris)).me.id;
    // Анну Jira находит только поиском (почта скрыта), у Бориса почта видна прямо в задаче.
    accounts.set(annaEmail, { accountId: "557058:anna", name: "Anna Jira", showEmail: false });
    accounts.set(borisEmail, { accountId: "557058:boris", name: "Boris Jira", showEmail: true });
    issues = [
      issue("DEV-3", "Medium", "To Do", "new", null),
      issue("DEV-1", "High", "In Progress", "indeterminate", user("557058:anna", "Anna Jira"), {
        duedate: "2026-10-20",
        description: {
          type: "doc",
          version: 1,
          content: [
            { type: "paragraph", content: [{ type: "text", text: "макет", marks: [{ type: "link", attrs: { href: FRAME_URL } }] }] },
            { type: "paragraph", content: [{ type: "inlineCard", attrs: { url: FRAME_URL } }] },
          ],
        },
      }),
      issue("DEV-2", "Highest", "To Do", "new", user("557058:boris", "Boris Jira", borisEmail)),
      issue("DEV-4", "Highest", "Done", "done", user("557058:anna", "Anna Jira")),
      ...Array.from({ length: 250 }, (_, i) => issue(`BIG-${i + 1}`, "Medium", "To Do", "new", null)),
    ];
    channel = (await call(anna, "POST", "/api/conversations", { name: `tasks-${run}`, memberIds: [borisId] })).body;
    secret = (await call(anna, "POST", "/api/conversations", { name: `tasks-secret-${run}`, kind: "private" })).body;
    borisLive = connect(boris, (await boot(boris)).lastEventId);
    await borisLive.synced;
    borisTasks = [];
    borisLive.socket.on("tasks", (e) => borisTasks.push(e));
  });

  after(async () => {
    closeSockets();
    await Promise.all([new Promise((r) => jira.close(r)), new Promise((r) => figma.close(r))]);
  });

  test("the server says what is connected; a fresh channel has no task sources", async () => {
    assert.deepEqual((await call(anna, "GET", "/api/integrations")).body, { jira: { site: process.env.JIRA_BASE_URL }, figma: true });
    const res = await call(anna, "GET", `/api/conversations/${channel.id}/tasks`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { source: { jql: null, figmaFiles: [], updatedBy: null, updatedAt: null }, jira: null, figma: null });
    assert.equal((await call(anna, "GET", "/api/jira/projects")).body[0].key, "DEV");
  });

  test("a JQL Jira rejects and a Figma file the token can't open are not saved", async () => {
    const bad = await call(anna, "PUT", `/api/conversations/${channel.id}/tasks/source`, { jql: "project = NOPE", figmaFiles: [] });
    assert.equal(bad.status, 400);
    assert.match(bad.body.message, /Jira не приняла JQL: The value 'NOPE' does not exist/);
    const locked = await call(anna, "PUT", `/api/conversations/${channel.id}/tasks/source`, {
      jql: null,
      figmaFiles: [`https://www.figma.com/design/${NOACCESS}/Secret`],
    });
    assert.equal(locked.status, 400);
    assert.match(locked.body.message, /Нет доступа к файлу Figma/);
    const notFigma = await call(anna, "PUT", `/api/conversations/${channel.id}/tasks/source`, { jql: null, figmaFiles: ["https://example.com/x"] });
    assert.equal(notFigma.status, 400);
    assert.equal((await call(anna, "GET", `/api/conversations/${channel.id}/tasks`)).body.source.jql, null);
  });

  test("a channel shows open Jira tasks by priority and open Figma comments", async () => {
    const res = await call(anna, "PUT", `/api/conversations/${channel.id}/tasks/source`, {
      jql: "project = DEV ORDER BY created DESC",
      figmaFiles: [FRAME_URL],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Сортировку канала сервер заменяет своей и сам отсекает завершённые.
    const sent = jiraLog.filter((r) => r.path === "/rest/api/3/search/jql").at(-1).body;
    assert.equal(sent.jql, "(project = DEV) AND statusCategory != Done ORDER BY priority DESC, updated DESC");
    assert.ok(sent.fields.includes("description"));

    const { source, jira: list, figma: design } = res.body;
    assert.equal(source.jql, "project = DEV");
    assert.deepEqual(source.figmaFiles, [{ fileKey: FILE, name: "Ads — Campaigns", url: `https://www.figma.com/file/${FILE}` }]);
    assert.equal(source.updatedBy, annaId);
    assert.deepEqual(
      list.issues.map((i) => [i.key, i.priority.level, i.status.category]),
      [
        ["DEV-2", 1, "new"],
        ["DEV-1", 2, "indeterminate"],
        ["DEV-3", 3, "new"],
      ],
    );
    assert.equal(list.truncated, false);
    assert.equal(list.error, null);
    const dev1 = list.issues[1];
    assert.equal(dev1.url, `${process.env.JIRA_BASE_URL}/browse/DEV-1`);
    assert.equal(dev1.dueDate, "2026-10-20");
    // Одна и та же ссылка в описании дважды (меткой и карточкой) — один макет.
    assert.deepEqual(dev1.figma, [{ url: FRAME_URL, fileKey: FILE, nodeId: "1:2" }]);
    // Борис узнан по почте прямо из задачи.
    assert.equal(list.issues[0].assignee.userId, borisId);
    assert.equal(list.issues[2].assignee, null);

    assert.equal(design.error, null);
    assert.deepEqual(
      design.comments.map((c) => [c.id, c.text, c.fileName, c.nodeId, c.replyCount, c.author.handle]),
      [["101", "Отступ у кнопки 16, не 12", "Ads — Campaigns", "1:2", 1, "Designer"]],
    );
    assert.equal(design.comments[0].url, `https://www.figma.com/file/${FILE}?node-id=1-2#101`);

    // Остальные участники канала узнают, что источники поменялись.
    await waitFor(() => borisTasks.some((e) => e.conversationId === channel.id));
  });

  test("Anna is found in Jira by email in the background, then her tasks show her chat avatar", async () => {
    for (let i = 0; i < 40; i++) {
      const res = await call(boris, "GET", `/api/conversations/${channel.id}/tasks`);
      if (res.body.jira.issues[1].assignee.userId === annaId) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail("Anna was not matched to her Jira account");
  });

  test("search results are cached for a moment", async () => {
    const before = jiraLog.filter((r) => r.path === "/rest/api/3/search/jql").length;
    await call(anna, "GET", `/api/conversations/${channel.id}/tasks`);
    await call(boris, "GET", `/api/conversations/${channel.id}/tasks`);
    assert.equal(jiraLog.filter((r) => r.path === "/rest/api/3/search/jql").length, before);
  });

  test("outsiders can read a public channel's tasks, not a private one's, and can't change them", async () => {
    assert.equal((await call(carl, "GET", `/api/conversations/${channel.id}/tasks`)).status, 200);
    assert.equal((await call(carl, "GET", `/api/conversations/${secret.id}/tasks`)).status, 404);
    const change = await call(carl, "PUT", `/api/conversations/${channel.id}/tasks/source`, { jql: "project = DEV", figmaFiles: [] });
    assert.equal(change.status, 403);
    const dm = (await call(anna, "POST", "/api/conversations/dm", { userIds: [borisId] })).body;
    assert.equal((await call(anna, "GET", `/api/conversations/${dm.id}/tasks`)).status, 400);
  });

  test("my tasks: open issues assigned to me; no Jira account — an empty list", async () => {
    const mine = await call(anna, "GET", "/api/me/tasks");
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.deepEqual(mine.body.account, { accountId: "557058:anna", name: "Anna Jira", avatarUrl: "https://avatar.example/557058:anna.png", userId: annaId });
    assert.deepEqual(
      mine.body.jira.issues.map((i) => i.key),
      ["DEV-1"],
    );
    const sent = jiraLog.filter((r) => r.path === "/rest/api/3/search/jql").at(-1).body;
    assert.equal(sent.jql, 'assignee = "557058:anna" AND statusCategory != Done ORDER BY priority DESC, updated DESC');
    assert.ok(jiraLog.some((r) => r.path === "/rest/api/3/user/search" && r.query.includes(encodeURIComponent("anna9."))));

    const nobody = await call(carl, "GET", "/api/me/tasks");
    assert.deepEqual(nobody.body, { account: null, jira: { issues: [], truncated: false, error: null } });
  });

  test("a long JQL result is cut at 200 issues", async () => {
    const res = await call(anna, "PUT", `/api/conversations/${channel.id}/tasks/source`, { jql: "project = BIG", figmaFiles: [FRAME_URL] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.jira.issues.length, 200);
    assert.equal(res.body.jira.truncated, true);
  });

  test("a Figma frame preview is fetched once and served from our storage", async () => {
    const q = `/api/figma/preview?url=${encodeURIComponent(FRAME_URL)}`;
    const first = await call(anna, "GET", q);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.status, "ready");
    assert.equal(first.body.fileName, "Ads — Campaigns");
    assert.equal(first.body.nodeName, "Campaigns list");
    assert.equal(first.body.nodeId, "1:2");
    assert.equal(first.body.url, `https://www.figma.com/file/${FILE}?node-id=1-2`);
    assert.equal(first.body.image.width, 1024);
    assert.equal(first.body.image.height, 640);
    const nodeCalls = figmaLog.filter((p) => p.startsWith(`/v1/files/${FILE}/nodes`)).length;
    assert.equal((await call(boris, "GET", q)).body.id, first.body.id);
    assert.equal(figmaLog.filter((p) => p.startsWith(`/v1/files/${FILE}/nodes`)).length, nodeCalls);

    const img = await fetch(BASE + first.body.image.url, { headers: { cookie: anna } });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/webp");
    assert.equal((await fetch(BASE + first.body.image.url)).status, 401);
    assert.equal((await call(anna, "GET", "/api/figma/preview?url=https%3A%2F%2Fexample.com")).status, 400);
  });

  test("a Figma link in a message gets a preview card; only the author can remove it", async () => {
    const sent = await send(anna, channel.id, `Новый макет: ${FRAME_URL}`);
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.deepEqual(sent.body.unfurls, []);
    const updated = await waitFor(() =>
      borisLive.events.find((e) => e.kind === "message.updated" && e.payload.id === sent.body.id && e.payload.unfurls.length === 1),
    );
    const card = updated.payload.unfurls[0];
    assert.equal(card.kind, "figma");
    assert.equal(card.figma.nodeName, "Campaigns list");
    assert.ok(card.figma.image.url.startsWith(`/api/figma/previews/${card.figma.id}/image`));

    const page = await call(boris, "GET", `/api/conversations/${channel.id}/messages`);
    assert.equal(page.body.messages.find((m) => m.id === sent.body.id).unfurls[0].id, card.id);

    assert.equal((await call(boris, "POST", `/api/messages/${sent.body.id}/unfurls/${card.id}/hide`, {})).status, 403);
    assert.equal((await call(anna, "POST", `/api/messages/${sent.body.id}/unfurls/${card.id}/hide`, {})).status, 204);
    await waitFor(() => borisLive.events.find((e) => e.kind === "message.updated" && e.payload.id === sent.body.id && e.payload.unfurls.length === 0));
  });

  test("clearing the sources turns the tab back to empty", async () => {
    const res = await call(boris, "PUT", `/api/conversations/${channel.id}/tasks/source`, { jql: "", figmaFiles: [] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { source: { jql: null, figmaFiles: [], updatedBy: null, updatedAt: null }, jira: null, figma: null });
  });
});
