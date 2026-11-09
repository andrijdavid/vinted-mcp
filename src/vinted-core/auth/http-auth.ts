import { TokenCache } from "./token-cache";
import { getBaseUrl, getCountry } from "../models/country";
import type { AuthSession } from "../types";
import {
  cookieHeaderFromMap,
  defaultDesktopUserAgent,
  parseCookiesFromSetCookie,
  parseSetCookieHeaders,
  runtimeRequire
} from "./utils";

export class HttpAuth {
  constructor(
    private readonly tokenCache: TokenCache = new TokenCache(),
    private readonly proxyUrl?: string
  ) {}

  async createSession(country: string): Promise<AuthSession> {
    const key = country.toLowerCase();
    const cached = this.tokenCache.get(key);
    if (cached) {
      return cached;
    }

    const countryInfo = getCountry(country);
    const baseUrl = getBaseUrl(country);
    const dispatcher = this.getProxyDispatcher();
    const ua = defaultDesktopUserAgent();

    const homepageRes = await fetch(baseUrl, {
      method: "GET",
      headers: {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": `${countryInfo.language},en;q=0.5`
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      ...(dispatcher ? { dispatcher } : {})
    } as RequestInit);

    if (!homepageRes.ok) throw new Error(`Vinted session request failed (${homepageRes.status}); no bypass attempted`);
    const cookies = parseCookiesFromSetCookie(parseSetCookieHeaders(homepageRes.headers));
    const html = await homepageRes.text();

    let csrfToken = cookies.csrf_token || cookies._csrf_token || "";
    if (!csrfToken) {
      const csrfMatch = html.match(/name="csrf-token"\s+content="([^"]+)"/);
      if (csrfMatch) {
        csrfToken = csrfMatch[1];
      }
    }

    const cookieHeader = cookieHeaderFromMap(cookies);
    let accessToken = cookies.access_token_web || "";

    if (!accessToken) {
      const tokenMatch = html.match(/"accessToken"\s*:\s*"([^"]+)"/);
      if (tokenMatch) {
        accessToken = tokenMatch[1];
      }
    }

    if (!accessToken) {
      try {
        const tokenRes = await fetch(`${baseUrl}/api/v2/users/current`, {
          signal: AbortSignal.timeout(15_000),
          redirect: "error",
          headers: {
            "User-Agent": ua,
            "Accept": "application/json, text/plain, */*",
            "Cookie": cookieHeader,
            "X-CSRF-Token": csrfToken
          },
          ...(dispatcher ? { dispatcher } : {})
        } as RequestInit);

        if (tokenRes.ok) {
          const data = (await tokenRes.json()) as { access_token?: string };
          accessToken = data.access_token || "";
        }

        const refreshed = parseCookiesFromSetCookie(parseSetCookieHeaders(tokenRes.headers));
        Object.assign(cookies, refreshed);
        if (refreshed.csrf_token) {
          csrfToken = refreshed.csrf_token;
        } else if (refreshed._csrf_token) {
          csrfToken = refreshed._csrf_token;
        }
      } catch {
        // Ignore token endpoint failure and continue with available cookie data.
      }
    }

    const session: AuthSession = {
      accessToken,
      cookies,
      csrfToken,
      country: key,
      expiresAt: Date.now() + 25 * 60 * 1000
    };

    this.tokenCache.set(key, session);
    return session;
  }

  private getProxyDispatcher(): unknown {
    if (!this.proxyUrl) {
      return undefined;
    }

    try {
      const undici = runtimeRequire("undici") as { ProxyAgent?: new (url: string) => unknown };
      if (undici.ProxyAgent) {
        return new undici.ProxyAgent(this.proxyUrl);
      }
    } catch {
      return undefined;
    }

    return undefined;
  }
}
