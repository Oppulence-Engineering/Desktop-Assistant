import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { z } from "zod";

import { getAuthRuntimeConfig } from "@/lib/auth/config";
import {
  DashboardSessionCookieSchema,
  WorkOSPKCECookieSchema,
  type DashboardSessionCookie,
  type WorkOSPKCECookie,
} from "@/lib/auth/schemas";

export const SESSION_COOKIE = "rowboat_www_session";
const PKCE_COOKIE = "rowboat_www_pkce";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
const PKCE_MAX_AGE_SECONDS = 60 * 10;

type CookiePayload = DashboardSessionCookie | WorkOSPKCECookie;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function cookieKey(): Buffer {
  return createHash("sha256").update(getAuthRuntimeConfig().sessionSecret).digest();
}

function sealCookieValue(value: CookiePayload): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cookieKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", base64url(iv), base64url(ciphertext), base64url(tag)].join(".");
}

function verifyCookieValue<T>(raw: string | undefined, schema: z.ZodType<T>): T | null {
  if (!raw) return null;
  const [version, iv, ciphertext, tag, extra] = raw.split(".");
  if (version !== "v1" || !iv || !ciphertext || !tag || extra !== undefined) return null;

  try {
    const decipher = createDecipheriv("aes-256-gcm", cookieKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]);
    const parsed = JSON.parse(plaintext.toString("utf8"));
    return schema.parse(parsed);
  } catch {
    return null;
  }
}

function cookieOptions(maxAge: number) {
  const { isProduction } = getAuthRuntimeConfig();
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

/** Reads and decrypts the sealed dashboard session from the incoming request. */
export function readSessionCookie(request: NextRequest): DashboardSessionCookie | null {
  return readSessionCookieValue(request.cookies.get(SESSION_COOKIE)?.value);
}

/** Reads and decrypts a session supplied by a Server Component cookie store. */
export function readSessionCookieValue(raw: string | undefined): DashboardSessionCookie | null {
  return verifyCookieValue(raw, DashboardSessionCookieSchema);
}

/** Installs the sealed dashboard session cookie on a Next response. */
export function setSessionCookie(response: NextResponse, session: DashboardSessionCookie): void {
  response.cookies.set(
    SESSION_COOKIE,
    sealCookieValue(session),
    cookieOptions(SESSION_MAX_AGE_SECONDS),
  );
}

/** Clears all auth cookies that rowboat-www owns. */
export function clearAuthCookies(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
  response.cookies.set(PKCE_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
}

export function readPKCECookie(request: NextRequest): WorkOSPKCECookie | null {
  return verifyCookieValue(request.cookies.get(PKCE_COOKIE)?.value, WorkOSPKCECookieSchema);
}

export function setPKCECookie(response: NextResponse, pending: WorkOSPKCECookie): void {
  response.cookies.set(PKCE_COOKIE, sealCookieValue(pending), cookieOptions(PKCE_MAX_AGE_SECONDS));
}

export function clearPKCECookie(response: NextResponse): void {
  response.cookies.set(PKCE_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
}
