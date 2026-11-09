import { TokenCache } from "./token-cache";
import type { AuthSession } from "../types";
import { getBaseUrl } from "../models/country";

const INVALIDATION_COOLDOWN_MS = 30 * 1000;

export class EnvAuth {
  private readonly invalidatedAt = new Map<string, number>();

  constructor(private readonly tokenCache: TokenCache = new TokenCache()) {}

  async createSession(country: string): Promise<AuthSession> {
    const key = country.toLowerCase();
    const cached = this.tokenCache.get(key);
    if (cached) {
      return cached;
    }

    const failedAt = this.invalidatedAt.get(key);
    if (failedAt && Date.now() - failedAt < INVALIDATION_COOLDOWN_MS) {
      throw new Error(
        `Env auth for '${key}' was invalidated. Refresh VINTED_AUTH_* environment variables and retry.`
      );
    }

    let accessToken = process.env.VINTED_AUTH_ACCESS_TOKEN?.trim() || "";
    const csrfToken = process.env.VINTED_AUTH_CSRF_TOKEN?.trim() || "";
    const cookieValue = process.env.VINTED_AUTH_COOKIES?.trim() || "";
    const cookies = parseCookies(cookieValue);

    if (!accessToken && cookies.access_token_web) {
      accessToken = cookies.access_token_web;
    }

    let refreshToken = process.env.VINTED_AUTH_REFRESH_TOKEN?.trim() || "";
    if (!refreshToken && cookies.refresh_token_web) {
      refreshToken = cookies.refresh_token_web;
    }

    if (!accessToken && !csrfToken && Object.keys(cookies).length === 0) {
      throw new Error(
        "Auth mode is 'env' but no credentials were found. Set VINTED_AUTH_COOKIES, VINTED_AUTH_ACCESS_TOKEN, or VINTED_AUTH_CSRF_TOKEN."
      );
    }

    if (!accessToken && refreshToken) {
      const refreshed = await this.refresh(key, refreshToken, cookies, csrfToken);
      if (refreshed) {
        accessToken = refreshed.accessToken;
        if (refreshed.cookies) {
          Object.assign(cookies, refreshed.cookies);
        }
      }
    }

    const session: AuthSession = {
      accessToken,
      csrfToken,
      cookies,
      country: key,
      expiresAt: Date.now() + 25 * 60 * 1000
    };

    this.tokenCache.set(key, session);
    this.invalidatedAt.delete(key);
    return session;
  }

  invalidate(country: string): void {
    const key = country.toLowerCase();
    this.tokenCache.invalidate(key);
    this.invalidatedAt.set(key, Date.now());
  }

  clear(): void {
    this.tokenCache.invalidateAll();
    this.invalidatedAt.clear();
  }

  private async refresh(
    country: string,
    refreshToken: string,
    cookies: Record<string, string>,
    csrfToken: string
  ): Promise<{ accessToken: string; cookies?: Record<string, string> } | null> {
    try {
      const baseUrl = getBaseUrl(country);
      const cookieHeader = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");

      const res = await fetch(`${baseUrl}/oauth/token`, {
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Cookie: cookieHeader,
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {})
        },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken })
      });

      if (!res.ok) {
        return null;
      }

      const data = (await res.json()) as { access_token?: string };
      if (!data.access_token) {
        return null;
      }
      return { accessToken: data.access_token };
    } catch {
      return null;
    }
  }
}

function parseCookies(raw: string): Record<string, string> {
  if (!raw) {
    return {};
  }

  if (raw.startsWith("{")) {
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(json)) {
        if (typeof value === "string") {
          out[key] = value;
        }
      }
      return out;
    } catch {
      return {};
    }
  }

  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const entry = part.trim();
    if (!entry) {
      continue;
    }
    const idx = entry.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = entry.slice(0, idx).trim();
    const value = entry.slice(idx + 1).trim();
    if (key) {
      out[key] = value;
    }
  }
  return out;
}
