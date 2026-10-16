import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash("sha256").update(value).digest());
}

export function newLoginCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

// Код короткий, поэтому храним HMAC с секретом сервера: утечка таблицы не даёт перебрать коды офлайн.
export function hashLoginCode(email: string, code: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHmac("sha256", config.AUTH_SECRET).update(`${email}\n${code}`).digest());
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
