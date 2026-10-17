// Вход через Google: OAuth 2.0 authorization code + PKCE. Состояние между редиректами —
// в подписанной httpOnly-cookie, поэтому серверу не нужно ничего хранить.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { config } from "../config.js";
import { sameBytes } from "./crypto.js";
import type { GoogleProfile } from "./auth.service.js";

export const GOOGLE_STATE_COOKIE = "g_oauth";
export const GOOGLE_STATE_TTL_MS = 10 * 60_000;

// desktop — S256-хэш verifier десктоп-приложения: после входа сессия уйдёт ему, а не в этот браузер.
type State = { state: string; verifier: string; invite?: string; desktop?: string; at: number };

export class GoogleAuthError extends Error {
  constructor(readonly code: "state" | "denied" | "exchange" | "unverified") {
    super(code);
  }
}

const b64url = (buf: Buffer) => buf.toString("base64url");
const sign = (data: string) => createHmac("sha256", config.AUTH_SECRET).update(`google-state\n${data}`).digest("base64url");

@Injectable()
export class GoogleAuthService {
  readonly enabled = Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
  private readonly redirectUri = `${config.APP_URL}/api/auth/google/callback`;

  start(invite?: string, desktop?: string): { url: string; cookie: string } {
    const st: State = { state: b64url(randomBytes(24)), verifier: b64url(randomBytes(32)), invite, desktop, at: Date.now() };
    const challenge = b64url(createHash("sha256").update(st.verifier).digest());
    const url = new URL(config.GOOGLE_AUTH_URL);
    url.search = new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID ?? "",
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: st.state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    const data = b64url(Buffer.from(JSON.stringify(st)));
    return { url: url.toString(), cookie: `${data}.${sign(data)}` };
  }

  readState(cookie: string | undefined, state: string | undefined): State {
    const [data, mac] = (cookie ?? "").split(".");
    if (!data || !mac || !state || !sameBytes(Buffer.from(mac), Buffer.from(sign(data)))) throw new GoogleAuthError("state");
    const st = JSON.parse(Buffer.from(data, "base64url").toString()) as State;
    if (Date.now() - st.at > GOOGLE_STATE_TTL_MS || !sameBytes(Buffer.from(st.state), Buffer.from(state))) {
      throw new GoogleAuthError("state");
    }
    return st;
  }

  // id_token получен напрямую с token endpoint по TLS и с client_secret, поэтому подпись
  // не проверяем (OIDC Core 3.1.3.7, п. 6), но проверяем выдачу, адресата, срок и почту.
  async exchange(code: string, verifier: string): Promise<GoogleProfile> {
    const res = await fetch(config.GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.GOOGLE_CLIENT_ID ?? "",
        client_secret: config.GOOGLE_CLIENT_SECRET ?? "",
        redirect_uri: this.redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new GoogleAuthError("exchange");
    const { id_token: idToken } = (await res.json()) as { id_token?: string };
    const payload = idToken?.split(".")[1];
    if (!payload) throw new GoogleAuthError("exchange");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;

    const issuerOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
    const fresh = typeof claims.exp === "number" && claims.exp * 1000 > Date.now();
    if (!issuerOk || claims.aud !== config.GOOGLE_CLIENT_ID || !fresh || typeof claims.sub !== "string") {
      throw new GoogleAuthError("exchange");
    }
    if (claims.email_verified !== true || typeof claims.email !== "string") throw new GoogleAuthError("unverified");
    return {
      sub: claims.sub,
      email: claims.email.toLowerCase(),
      name: typeof claims.name === "string" ? claims.name : "",
    };
  }
}
