// M1: приглашения (персональные и ссылки), онбординг, роли, деактивация, присутствие, вход через Google.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE,
  DOMAIN,
  boot,
  call,
  closeSockets,
  connect,
  cookieFrom,
  inviteTokenFrom,
  lastMailTo,
  login,
  requestCode,
  run,
  waitFor,
} from "./helpers.mjs";

const OUT = "outside.test";

describe("M1 people", () => {
  let owner, ownerBoot;
  let ivan, ivanId; // приглашён по почте, потом станет админом

  before(async () => {
    owner = await login(`owner@${DOMAIN}`);
    ownerBoot = await boot(owner);
  });
  after(closeSockets);

  test("bootstrap owner starts as primary owner, not onboarded", () => {
    assert.equal(ownerBoot.me.role, "primary_owner");
    assert.equal(typeof ownerBoot.me.onboarded, "boolean");
    assert.equal(ownerBoot.workspace.whoCanInvite, "everyone");
  });

  test("an emailed invite lets exactly that address in", async () => {
    const email = `ivan.${run}@${OUT}`;
    const since = new Date().toISOString();
    const res = await call(owner, "POST", "/api/invites", { emails: [email] });
    assert.deepEqual(res.body.results, [{ email, status: "sent" }]);
    const mail = await lastMailTo(email, since);
    const token = inviteTokenFrom(mail);
    assert.ok(token, "invite link in the email");

    const preview = await call(null, "GET", `/api/invites/preview/${token}`);
    assert.equal(preview.body.kind, "email");
    assert.equal(preview.body.email, email);

    const stranger = await requestCode(`eve.${run}@${OUT}`, token);
    assert.match(stranger.text, /нет доступа/, "someone else's address can't use a personal invite");

    ivan = await login(email, token);
    const me = (await boot(ivan)).me;
    ivanId = me.id;
    assert.equal(me.role, "member");
    assert.equal(me.onboarded, false);
    assert.equal((await call(null, "GET", `/api/invites/preview/${token}`)).status, 404, "single use");

    const again = await call(owner, "POST", "/api/invites", { emails: [email] });
    assert.equal(again.body.results[0].status, "already_member");
  });

  test("onboarding fills the profile and tells everyone", async () => {
    const live = connect(owner, (await boot(owner)).lastEventId);
    await live.synced;
    const res = await call(ivan, "POST", "/api/me/onboarding", {
      displayName: "Ivan",
      realName: "Иван Петров",
      title: "QA",
      tz: "Europe/Kyiv",
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.onboarded, true);
    assert.equal(res.body.tz, "Europe/Kyiv");
    await waitFor(() => live.events.find((e) => e.kind === "user.updated" && e.payload.id === ivanId && e.payload.realName === "Иван Петров"));

    const bogus = await call(ivan, "PATCH", "/api/me/profile", { tz: "Mars/Olympus", title: "QA lead" });
    assert.equal(bogus.body.tz, "Europe/Kyiv", "unknown time zone is ignored");
    assert.equal(bogus.body.title, "QA lead");
    live.socket.disconnect();
  });

  test("members invite members, but not admins and not by link", async () => {
    const asAdmin = await call(ivan, "POST", "/api/invites", { emails: [`x.${run}@${OUT}`], role: "admin" });
    assert.equal(asAdmin.status, 403);
    assert.equal((await call(ivan, "POST", "/api/invites/link", {})).status, 403);
    assert.equal((await call(ivan, "GET", "/api/invites")).status, 403);
    const asMember = await call(ivan, "POST", "/api/invites", { emails: [`y.${run}@${OUT}`] });
    assert.equal(asMember.body.results[0].status, "sent");
  });

  test("an invite link has a use limit and can be revoked", async () => {
    const link = (await call(owner, "POST", "/api/invites/link", { maxUses: 1, days: 1 })).body;
    const token = link.url.split("/invite/")[1];
    assert.equal(link.invite.kind, "link");

    await login(`lena.${run}@${OUT}`, token);
    const second = await requestCode(`olga.${run}@${OUT}`, token);
    assert.match(second.text, /нет доступа/, "the link is used up");

    const other = (await call(owner, "POST", "/api/invites/link", {})).body;
    const listed = (await call(owner, "GET", "/api/invites")).body;
    assert.ok(listed.some((i) => i.id === other.invite.id));
    assert.equal((await call(owner, "DELETE", `/api/invites/${other.invite.id}`)).status, 204);
    assert.equal((await call(null, "GET", `/api/invites/preview/${other.url.split("/invite/")[1]}`)).status, 404);
  });

  test("roles: only below your own rank", async () => {
    assert.equal((await call(owner, "PATCH", `/api/admin/users/${ivanId}`, { role: "admin" })).body.role, "admin");
    const victim = (await boot(owner)).users.find((u) => u.email === `lena.${run}@${OUT}`);
    assert.equal((await call(ivan, "PATCH", `/api/admin/users/${victim.id}`, { role: "admin" })).status, 403, "admin can't mint admins");
    assert.equal((await call(ivan, "PATCH", `/api/admin/users/${ownerBoot.me.id}`, { role: "member" })).status, 403, "admin can't touch owner");
    const list = await call(ivan, "GET", "/api/admin/users");
    assert.equal(list.status, 200);
    assert.ok(list.body.some((u) => u.id === victim.id && "lastSeenAt" in u));
  });

  test("deactivation locks someone out at once; reactivation brings them back", async () => {
    const email = `dima.${run}@${DOMAIN}`;
    const dima = await login(email);
    const dimaId = (await boot(dima)).me.id;
    const dimaSocket = connect(dima, (await boot(dima)).lastEventId);
    await dimaSocket.synced;

    const res = await call(ivan, "POST", `/api/admin/users/${dimaId}/deactivate`, {});
    assert.equal(res.body.deactivated, true);
    assert.equal((await call(dima, "GET", "/api/boot")).status, 401, "session revoked");
    await waitFor(() => !dimaSocket.socket.connected);
    const general = (await boot(owner)).conversations.find((c) => c.isGeneral);
    assert.ok(!general.memberIds.includes(dimaId), "left #general");
    assert.match((await requestCode(email)).text, /нет доступа/);

    assert.equal((await call(ivan, "POST", `/api/admin/users/${dimaId}/reactivate`, {})).body.deactivated, false);
    const back = await login(email);
    assert.ok((await boot(back)).conversations.some((c) => c.isGeneral), "back in #general");
    assert.equal((await call(ivan, "POST", `/api/admin/users/${ownerBoot.me.id}/deactivate`, {})).status, 403);
  });

  test("presence: online with a socket, away without", async () => {
    const watcher = connect(owner, (await boot(owner)).lastEventId);
    await watcher.synced;
    const ivanSocket = connect(ivan, (await boot(ivan)).lastEventId);
    await ivanSocket.synced;
    await waitFor(() => watcher.presence.find((p) => p.userId === ivanId && p.presence === "active"));
    assert.equal((await boot(owner)).presence[ivanId], "active");
    ivanSocket.socket.disconnect();
    await waitFor(() => watcher.presence.find((p) => p.userId === ivanId && p.presence === "away"));
    watcher.socket.disconnect();
  });
});

describe("M1 Google sign-in", () => {
  // Поддельный Google: отдаёт id_token с профилем, заданным тестом, и проверяет PKCE.
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
        const verifier = form.get("code_verifier") ?? "";
        const challenge = createHash("sha256").update(verifier).digest("base64url");
        if (req.url !== "/token" || challenge !== lastChallenge || form.get("client_id") !== "e2e-client") {
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

  async function googleFlow(profile, invite) {
    nextProfile = profile;
    const start = await call(null, "GET", `/api/auth/google/start${invite ? `?invite=${invite}` : ""}`);
    assert.equal(start.status, 302);
    const to = new URL(start.headers.get("location"));
    assert.equal(to.origin, `http://localhost:${port}`);
    assert.equal(to.searchParams.get("code_challenge_method"), "S256");
    lastChallenge = to.searchParams.get("code_challenge");
    const stateCookie = cookieFrom(start.headers, "g_oauth");
    const cb = await call(stateCookie, "GET", `/api/auth/google/callback?code=abc&state=${to.searchParams.get("state")}`);
    assert.equal(cb.status, 302);
    return { location: cb.headers.get("location"), sid: cookieFrom(cb.headers, "sid") };
  }

  test("providers report Google as available", async () => {
    assert.equal((await call(null, "GET", "/api/auth/providers")).body.google, true);
  });

  test("a verified address from an allowed domain signs in and gets its Google name", async () => {
    const { location, sid } = await googleFlow({ sub: `g-${run}-1`, email: `gina.${run}@${DOMAIN}`, email_verified: true, name: "Gina Test" });
    assert.equal(location, "/");
    const me = (await boot(sid)).me;
    assert.equal(me.displayName, "Gina Test");
    assert.equal(me.onboarded, false);
    const again = await googleFlow({ sub: `g-${run}-1`, email: `gina.${run}@${DOMAIN}`, email_verified: true, name: "Gina Test" });
    assert.equal((await boot(again.sid)).me.id, me.id, "same Google account → same person");
  });

  test("refusals: bad state, unverified address, no access", async () => {
    const forged = await call("g_oauth=forged.mac", "GET", "/api/auth/google/callback?code=abc&state=x");
    assert.equal(forged.headers.get("location"), "/signin?error=state");

    const unverified = await googleFlow({ sub: `g-${run}-2`, email: `uma.${run}@${DOMAIN}`, email_verified: false, name: "Uma" });
    assert.equal(unverified.location, "/signin?error=unverified");

    const outsider = await googleFlow({ sub: `g-${run}-3`, email: `oscar.${run}@${OUT}`, email_verified: true, name: "Oscar" });
    assert.equal(outsider.location, "/signin?error=no_access");
  });

  test("an invite link works through Google too", async () => {
    const owner = await login(`owner@${DOMAIN}`);
    const link = (await call(owner, "POST", "/api/invites/link", { maxUses: 5 })).body;
    const token = link.url.split("/invite/")[1];
    const { location, sid } = await googleFlow({ sub: `g-${run}-4`, email: `pavel.${run}@${OUT}`, email_verified: true, name: "Pavel" }, token);
    assert.equal(location, "/");
    assert.equal((await boot(sid)).me.email, `pavel.${run}@${OUT}`);
  });

  test("the start endpoint ignores malformed invite tokens", async () => {
    const res = await fetch(`${BASE}/api/auth/google/start?invite=%3Cscript%3E`, { redirect: "manual" });
    assert.equal(res.status, 302);
  });
});
