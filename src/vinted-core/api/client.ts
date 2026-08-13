import { CookieFactory } from "../auth/cookie-factory";
import { EnvAuth } from "../auth/env-auth";
import { HttpAuth } from "../auth/http-auth";
import { PlaywrightAuth } from "../auth/playwright-auth";
import { ProfileAuth, hasProfile, loginHint } from "../auth/profile-auth";
import { TokenCache } from "../auth/token-cache";
import { getBaseUrl } from "../models/country";
import {
  buildFavouriteToggleUrl,
  buildItemUrl,
  buildSearchUrl,
  buildUserItemsUrl,
  buildUserUrl
} from "./endpoints";
import { RateLimiter } from "./rate-limiter";
import { parseItem, parseItemDetail, parseSearchResponse, parseSellerProfile } from "../parsers/response-parser";
import type { AuthSession, ClientOptions, SearchParams } from "../types";
import { getRandomUserAgent, getBrowserHeaders, runtimeRequire } from "../auth/utils";

interface RequestOptions {
  method?: string;
  body?: unknown;
}

export class VintedAPIClient {
  private readonly tokenCache = new TokenCache();
  private readonly httpAuth: HttpAuth;
  private readonly envAuth: EnvAuth;
  private readonly profileAuth = new ProfileAuth();
  private readonly rateLimiter: RateLimiter;
  private readonly maxRetries: number;
  private readonly proxies: string[];
  private readonly authMode: "http" | "playwright" | "env";
  private cookieFactory: CookieFactory | null = null;
  private playwrightAuth: PlaywrightAuth | null;
  private consecutiveFailures = 0;
  private readonly sessionRequestCount = new Map<string, number>();
  private readonly sessionLocks = new Map<string, Promise<AuthSession>>();
  private cooldownUntil = 0;

  private static readonly MAX_CONSECUTIVE_FAILURES = 10;
  private static readonly BACKOFF_MS = 30000;
  private static readonly MAX_BACKOFF_MS = 60000;
  private static readonly LONG_COOLDOWN_MS = 5 * 60 * 1000;
  private static readonly MAX_REQUESTS_PER_SESSION = 40;

  constructor(options: ClientOptions = {}) {
    this.authMode = options.authMode || "http";
    this.proxies = options.proxies || (options.proxyUrl ? [options.proxyUrl] : []);
    this.httpAuth = new HttpAuth(this.tokenCache, this.proxies.length > 0 ? this.proxies[0] : undefined);
    this.envAuth = new EnvAuth(new TokenCache());
    this.rateLimiter = new RateLimiter(options.maxConcurrency || 5, options.requestDelayMs || 500, options.jitterMs || 300);
    this.maxRetries = options.maxRetries || 3;

    if (this.authMode === "playwright") {
      this.cookieFactory = new CookieFactory(this.tokenCache);
    }

    this.playwrightAuth = new PlaywrightAuth(new TokenCache(15 * 60 * 1000));
  }

  async searchItems(params: SearchParams) {
    const url = buildSearchUrl(params);
    const data = await this.makeRequest(url, params.country);
    return parseSearchResponse(data, params.country, params.page || 1, params.perPage || 24);
  }

  async getItem(id: number, country: string) {
    const apiUrl = buildItemUrl(id, country);

    if (this.playwrightAuth) {
      try {
        const data = await this.makePlaywrightRequest(apiUrl, country);
        return parseItemDetail(data.item || data, country);
      } catch {
        // Continue with fallback.
      }
    }

    try {
      const data = await this.makeRequest(apiUrl, country);
      return parseItemDetail(data.item || data, country);
    } catch {
      // Continue with HTML scraping fallback.
    }

    if (this.playwrightAuth) {
      try {
        return await this.scrapeItemPage(id, country);
      } catch (error: any) {
        console.warn(`[vinted-core] HTML scraping failed for item ${id}: ${error?.message || error}`);
      }
    }

    console.warn(`[vinted-core] All methods failed for item ${id}, returning partial data`);
    return {
      id,
      url: `${getBaseUrl(country)}/items/${id}`,
      title: "",
      description: "(All fetch methods failed)",
      price: 0,
      currency: "EUR",
      originalPrice: null,
      country,
      brand: null,
      brandId: null,
      category: null,
      categoryId: null,
      size: null,
      condition: null,
      color: null,
      photos: [],
      favouriteCount: 0,
      viewCount: 0,
      isSold: false,
      soldAt: null,
      createdAt: "",
      updatedAt: "",
      seller: {
        id: 0,
        username: "",
        rating: null,
        ratingCount: 0,
        itemCount: 0,
        followerCount: 0,
        lastSeenAt: null,
        country,
        profileUrl: ""
      },
      scrapedAt: new Date().toISOString()
    };
  }

  async getSeller(id: number, country: string) {
    const userUrl = buildUserUrl(id, country);
    const itemsUrl = buildUserItemsUrl(id, country);

    const fetchSellerData = async (requestFn: (url: string, country: string) => Promise<any>) => {
      const [userData, itemsData] = await Promise.all([
        requestFn(userUrl, country),
        requestFn(itemsUrl, country).catch(() => ({ items: [] }))
      ]);

      const raw = userData.user || userData;
      const profile = parseSellerProfile(raw, country);
      const items = (itemsData.items || []).map((item: any) => parseItem(item, country));
      return { ...profile, items, scrapedAt: new Date().toISOString() };
    };

    if (this.playwrightAuth) {
      try {
        return await fetchSellerData((url, c) => this.makePlaywrightRequest(url, c));
      } catch (error: any) {
        console.warn(`[vinted-core] Playwright auth failed for seller ${id}: ${error?.message || error}`);
      }
    }

    try {
      return await fetchSellerData((url, c) => this.makeRequest(url, c));
    } catch (error: any) {
      if (String(error?.message || "").includes("403") || String(error?.message || "").includes("Cloudflare")) {
        console.warn(`[vinted-core] Seller profile Cloudflare-blocked for ${id}, returning partial data`);
        return {
          id,
          username: "",
          profileUrl: `${getBaseUrl(country)}/member/${id}`,
          rating: null,
          ratingCount: 0,
          itemCount: 0,
          soldItemCount: 0,
          followerCount: 0,
          followingCount: 0,
          country,
          city: null,
          lastSeenAt: null,
          createdAt: "",
          verifications: { email: false, phone: false, facebook: false, google: false },
          items: [],
          scrapedAt: new Date().toISOString()
        };
      }

      throw error;
    }
  }

  async getSellerItems(id: number, country: string, perPage = 24) {
    const result = await this.searchItems({ country, userId: id, perPage });
    return result.items;
  }

  async getSoldItems(query: string, country: string, perPage = 24) {
    const result = await this.searchItems({ query, country, perPage, sortBy: "newest_first" });
    return result.items;
  }

  async getTrending(query: string, country: string, perPage = 24) {
    const result = await this.searchItems({ query, country, perPage, sortBy: "relevance" });
    return result.items.sort((a: any, b: any) => (b.favouriteCount || 0) - (a.favouriteCount || 0));
  }

  async comparePrices(query: string, countries: string[], limitPerCountry = 20) {
    const comparisons: Array<{
      country: string;
      avgPrice: number;
      medianPrice: number;
      minPrice: number;
      maxPrice: number;
      itemCount: number;
      currency: string;
    }> = [];

    const results = await Promise.allSettled(
      countries.map(async (country) => {
        const searchResult = await this.searchItems({
          query,
          country,
          perPage: limitPerCountry,
          sortBy: "relevance"
        });

        return { country, items: searchResult.items };
      })
    );

    for (const result of results) {
      if (result.status !== "fulfilled") {
        continue;
      }

      const { country, items } = result.value;
      if (!items.length) {
        continue;
      }

      const prices = items.map((item: any) => item.price).sort((a: number, b: number) => a - b);
      const sum = prices.reduce((a: number, b: number) => a + b, 0);
      const avg = sum / prices.length;
      const median =
        prices.length % 2 === 0
          ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
          : prices[Math.floor(prices.length / 2)];

      comparisons.push({
        country,
        avgPrice: Math.round(avg * 100) / 100,
        medianPrice: Math.round(median * 100) / 100,
        minPrice: prices[0],
        maxPrice: prices[prices.length - 1],
        itemCount: items.length,
        currency: items[0].currency
      });
    }

    const validComparisons = comparisons.filter((comparison) => comparison.avgPrice > 0);

    let bestBuyCountry = validComparisons[0]?.country || "";
    let bestSellCountry = validComparisons[0]?.country || "";
    let minAvg = Number.POSITIVE_INFINITY;
    let maxAvg = 0;

    for (const comparison of validComparisons) {
      if (comparison.avgPrice < minAvg) {
        minAvg = comparison.avgPrice;
        bestBuyCountry = comparison.country;
      }
      if (comparison.avgPrice > maxAvg) {
        maxAvg = comparison.avgPrice;
        bestSellCountry = comparison.country;
      }
    }

    const spread =
      maxAvg > 0 && Number.isFinite(minAvg)
        ? Math.round((((maxAvg - minAvg) / minAvg) * 100) * 10) / 10
        : 0;

    return {
      query,
      comparisons,
      bestBuyCountry,
      bestSellCountry,
      arbitrageSpreadPct: spread
    };
  }

  /**
   * Vinted's favourite endpoint is a toggle, so read the current state first;
   * liking an already-liked item would otherwise unlike it.
   */
  async setFavourite(itemId: number, country: string, liked: boolean) {
    const key = country.toLowerCase();
    const url = `${getBaseUrl(key)}/items/${itemId}`;

    try {
      const data = await this.makeRequest(buildItemUrl(itemId, key), key);
      const item = data.item || data;
      const wasLiked = Boolean(item.is_favourite);

      if (wasLiked !== liked) {
        await this.makeRequest(buildFavouriteToggleUrl(key), key, {
          method: "POST",
          body: { type: "item", user_favourites: [itemId] }
        });
      }

      return {
        id: itemId,
        title: item.title || "",
        liked,
        changed: wasLiked !== liked,
        url
      };
    } catch (error: any) {
      const message = String(error?.message || error);
      if (message.includes("401") || message.includes("403")) {
        throw new Error(`${loginHint(key)} (${message})`);
      }
      throw error;
    }
  }

  invalidateSession(country: string): void {
    this.tokenCache.invalidate(country);
    this.envAuth.invalidate(country);
  }

  clearSessions(): void {
    this.tokenCache.invalidateAll();
    this.envAuth.clear();
  }

  private async getSession(country: string): Promise<AuthSession> {
    const key = country.toLowerCase();
    const existing = this.sessionLocks.get(key);
    if (existing) {
      return existing;
    }

    const promise = this.createSession(key).finally(() => {
      this.sessionLocks.delete(key);
    });
    this.sessionLocks.set(key, promise);
    return promise;
  }

  private async createSession(country: string): Promise<AuthSession> {
    if (this.authMode === "env") {
      return this.envAuth.createSession(country);
    }

    if (hasProfile(country)) {
      try {
        return await this.profileAuth.createSession(country);
      } catch (error: any) {
        console.warn(`[vinted-core] Profile session failed for ${country}: ${error?.message || error}`);
      }
    }

    if (this.cookieFactory) {
      try {
        return await this.cookieFactory.createSession(country);
      } catch {
        // Fallback to HTTP auth.
      }
    }

    return this.httpAuth.createSession(country);
  }

  private async makeRequest(url: string, country: string, options: RequestOptions = {}, retryCount = 0): Promise<any> {
    const key = country.toLowerCase();

    if (this.consecutiveFailures >= VintedAPIClient.MAX_CONSECUTIVE_FAILURES) {
      if (Date.now() < this.cooldownUntil) {
        await sleep(this.cooldownUntil - Date.now());
      } else {
        this.cooldownUntil = Date.now() + VintedAPIClient.LONG_COOLDOWN_MS;
        this.rateLimiter.pause(VintedAPIClient.LONG_COOLDOWN_MS);
        console.warn(
          `[vinted-core] ${VintedAPIClient.MAX_CONSECUTIVE_FAILURES} consecutive failures, cooling down ${VintedAPIClient.LONG_COOLDOWN_MS}ms before retrying`
        );
        await sleep(VintedAPIClient.LONG_COOLDOWN_MS);
      }
      this.consecutiveFailures = 0;
      this.tokenCache.invalidate(key);
      this.sessionRequestCount.set(key, 0);
    }

    const currentCount = this.sessionRequestCount.get(key) || 0;
    if (currentCount >= VintedAPIClient.MAX_REQUESTS_PER_SESSION) {
      this.tokenCache.invalidate(key);
      this.sessionRequestCount.set(key, 0);
    }

    const session = await this.getSession(key);
    this.sessionRequestCount.set(key, (this.sessionRequestCount.get(key) || 0) + 1);

    const cookieHeader = Object.entries(session.cookies)
      .map(([k, value]) => `${k}=${value}`)
      .join("; ");

    const ua = getRandomUserAgent();
    const baseUrl = getBaseUrl(key);
    const headers: Record<string, string> = {
      ...getBrowserHeaders(ua),
      Cookie: cookieHeader,
      "X-CSRF-Token": session.csrfToken,
      Referer: `${baseUrl}/`,
      Origin: baseUrl
    };

    if (session.accessToken) {
      headers.Authorization = `Bearer ${session.accessToken}`;
    }

    try {
      const fetchOptions: Record<string, unknown> = {
        headers,
        redirect: "follow",
        method: options.method || "GET"
      };

      if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
        fetchOptions.body = JSON.stringify(options.body);
      }

      const dispatcher = this.getProxyDispatcher();
      if (dispatcher) {
        fetchOptions.dispatcher = dispatcher;
      }

      const response = await this.rateLimiter.execute(() => fetch(url, fetchOptions as RequestInit));

      if (response.ok) {
        this.consecutiveFailures = 0;
        return parseJsonBody(await response.text());
      }

      const status = response.status;
      const retriable = status === 401 || status === 403 || status === 429 || status === 503;

      if (retriable && retryCount < this.maxRetries) {
        this.tokenCache.invalidate(key);
        this.sessionRequestCount.set(key, 0);

        if (this.authMode === "env" && status === 401) {
          this.envAuth.invalidate(key);
        }

        if (status === 401 || status === 403) {
          this.profileAuth.invalidate(key);
        }

        let pauseMs = 0;
        if (status === 401) {
          // First 401 likely just an expired token; don't penalize backoff yet.
          pauseMs = retryCount === 0 ? 250 : this.computeBackoff(retryCount);
          if (retryCount > 0) {
            this.consecutiveFailures += 1;
          }
        } else {
          this.consecutiveFailures += 1;
          const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
          pauseMs = retryAfter ?? this.computeBackoff(this.consecutiveFailures);
        }

        const body = await response.text().catch(() => "");
        if (this.looksLikeCloudflare(response, body) && this.cookieFactory) {
          await this.cookieFactory.createSession(key).catch(() => undefined);
        }

        if (pauseMs > 0) {
          this.rateLimiter.pause(pauseMs);
          await sleep(pauseMs);
        }

        return this.makeRequest(url, key, options, retryCount + 1);
      }

      throw new Error(`Vinted API error: ${status} ${response.statusText}`);
    } catch (error: any) {
      if (retryCount < this.maxRetries && (error instanceof TypeError || error?.code === "ECONNRESET" || error?.code === "ETIMEDOUT")) {
        this.consecutiveFailures += 1;
        const pauseMs = this.computeBackoff(retryCount + 1);
        this.rateLimiter.pause(pauseMs);
        await sleep(pauseMs);
        return this.makeRequest(url, key, options, retryCount + 1);
      }

      throw error;
    }
  }

  private computeBackoff(attempt: number): number {
    const exp = Math.min(VintedAPIClient.MAX_BACKOFF_MS, 1000 * Math.pow(2, Math.max(0, attempt)));
    const jitter = Math.floor(Math.random() * 500);
    return exp + jitter;
  }

  private looksLikeCloudflare(response: Response, body: string): boolean {
    const server = response.headers.get("server")?.toLowerCase() || "";
    if (server.includes("cloudflare")) {
      return true;
    }
    if (response.headers.get("cf-mitigated") || response.headers.get("cf-ray")) {
      return true;
    }
    return body.includes("cf-challenge") || body.includes("Just a moment") || body.includes("Attention Required");
  }

  private async makePlaywrightRequest(url: string, country: string, retryCount = 0): Promise<any> {
    if (!this.playwrightAuth) {
      throw new Error("PlaywrightAuth not available");
    }

    const session = await this.playwrightAuth.createSession(country);
    const cookieHeader = Object.entries(session.cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");

    const userAgent = this.playwrightAuth.getUserAgent(country);
    const headers: Record<string, string> = {
      "User-Agent": userAgent,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: cookieHeader,
      "X-CSRF-Token": session.csrfToken,
      Referer: `${getBaseUrl(country)}/`,
      Origin: getBaseUrl(country)
    };

    if (session.accessToken) {
      headers.Authorization = `Bearer ${session.accessToken}`;
    }

    const response = await this.rateLimiter.execute(() =>
      fetch(url, {
        headers,
        redirect: "follow"
      })
    );

    this.playwrightAuth.incrementRequestCount(country);

    if (response.ok) {
      return response.json();
    }

    if ((response.status === 403 || response.status === 429) && retryCount < 1) {
      this.playwrightAuth = new PlaywrightAuth(new TokenCache(15 * 60 * 1000));
      return this.makePlaywrightRequest(url, country, retryCount + 1);
    }

    throw new Error(`Vinted API error (playwright): ${response.status} ${response.statusText}`);
  }

  private async scrapeItemPage(id: number, country: string): Promise<any> {
    if (!this.playwrightAuth) {
      throw new Error("PlaywrightAuth not available");
    }

    const baseUrl = getBaseUrl(country);
    const pageUrl = `${baseUrl}/items/${id}`;
    const session = await this.playwrightAuth.createSession(country);
    const cookieHeader = Object.entries(session.cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");

    const response = await fetch(pageUrl, {
      headers: {
        "User-Agent": this.playwrightAuth.getUserAgent(country),
        Accept: "text/html,application/xhtml+xml",
        Cookie: cookieHeader
      },
      redirect: "follow"
    });

    if (!response.ok) {
      throw new Error(`Page fetch failed: ${response.status}`);
    }

    const html = await response.text();
    this.playwrightAuth.incrementRequestCount(country);

    const ldJsonMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    const ldJson = ldJsonMatch ? JSON.parse(ldJsonMatch[1]) : null;

    const itemDataMatch = html.match(/"item":\{"id":\d+,"title":"[^"]*","catalog_id":\d+[\s\S]*?"currency":"[A-Z]+"/);
    let rscItem: any = null;

    if (itemDataMatch) {
      const startIdx = html.indexOf(itemDataMatch[0]) - 1;
      rscItem = this.extractJsonFromRSC(html, startIdx + 8);
    }

    const sellerIdMatch = html.match(/"sellerId":(\d+)/);
    const sellerId = sellerIdMatch ? parseInt(sellerIdMatch[1], 10) : 0;

    const photos: string[] = [];
    const photoMatches = html.matchAll(/"url":"(https:\/\/images1\.vinted\.net\/[^"]*\/f800\/[^"]+)"/g);
    for (const match of photoMatches) {
      if (!photos.includes(match[1])) {
        photos.push(match[1]);
      }
    }

    const brandMatch = html.match(/"code":"summary_brand","style":"body".*?"value":"([^"]+)"/);

    const item = {
      id,
      url: ldJson?.offers?.url || `${baseUrl}/items/${id}`,
      title: ldJson?.name || rscItem?.title || "",
      description: ldJson?.description || rscItem?.description || "",
      price: Number(ldJson?.offers?.price || 0),
      currency: ldJson?.offers?.priceCurrency || "EUR",
      originalPrice: null,
      country,
      brand: ldJson?.brand?.name || brandMatch?.[1] || null,
      brandId: null,
      category: ldJson?.category || null,
      categoryId: rscItem?.catalog_id || null,
      size: null,
      condition: ldJson?.offers?.itemCondition?.replace("Condition", "") || null,
      color: ldJson?.color || null,
      photos: photos.length > 0 ? photos : ldJson?.image ? [ldJson.image] : [],
      favouriteCount: 0,
      viewCount: 0,
      isSold: ldJson?.offers?.availability === "OutOfStock" || rscItem?.is_closed || false,
      soldAt: null,
      createdAt: "",
      updatedAt: "",
      seller: {
        id: sellerId,
        username: "",
        rating: null,
        ratingCount: 0,
        itemCount: 0,
        followerCount: 0,
        lastSeenAt: null,
        country,
        profileUrl: `${baseUrl}/member/${sellerId}`
      },
      scrapedAt: new Date().toISOString()
    };

    const attrSizeMatch = html.match(/"code":"size"[^}]*"value":"([^"]+)"/);
    if (attrSizeMatch) {
      item.size = attrSizeMatch[1];
    }

    const sizeLineMatch = html.match(/"elements":\[\{"type":"text","value":"([^"]+)","style":"body"\}/);
    if (sizeLineMatch && !item.size) {
      item.size = sizeLineMatch[1];
    }

    return item;
  }

  private extractJsonFromRSC(html: string, startIdx: number): any {
    let depth = 0;
    let inString = false;
    let escaped = false;
    const start = startIdx;

    for (let i = startIdx; i < html.length && i < startIdx + 10000; i += 1) {
      const ch = html[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (ch === "{" || ch === "[") {
        depth += 1;
      }

      if (ch === "}" || ch === "]") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }

    return null;
  }

  private getProxyDispatcher(): unknown {
    if (!this.proxies || this.proxies.length === 0) {
      return undefined;
    }

    const proxy = this.proxies[Math.floor(Math.random() * this.proxies.length)];

    try {
      const undici = runtimeRequire("undici") as { ProxyAgent?: new (url: string) => unknown };
      if (undici.ProxyAgent) {
        return new undici.ProxyAgent(proxy);
      }
    } catch {
      return undefined;
    }

    return undefined;
  }
}

function parseJsonBody(text: string): any {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(120_000, Math.round(seconds * 1000));
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, Math.min(120_000, date - Date.now()));
  }
  return null;
}
