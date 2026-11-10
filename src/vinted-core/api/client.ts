import { parseItemPage } from "../../visual/item-page";
import { TTLCache } from "../../visual/common";
import { readBounded, decodeText, fetchSameOrigin } from "../../visual/network";
import { CookieFactory } from "../auth/cookie-factory";
import { EnvAuth } from "../auth/env-auth";
import { HttpAuth } from "../auth/http-auth";
import { PlaywrightAuth } from "../auth/playwright-auth";
import { ProfileAuth, hasProfile, loginHint } from "../auth/profile-auth";
import { TokenCache } from "../auth/token-cache";
import { getBaseUrl, getCountry } from "../models/country";
import {
  buildFavouriteToggleUrl,
  buildItemPageUrl,
  buildSearchUrl,
  buildUserFeedbacksUrl,
  buildUserUrl,
  buildWardrobeUrl
} from "./endpoints";
import { RateLimiter } from "./rate-limiter";
import { parseItem, parseSearchResponse, parseSeller, parseSellerProfile } from "../parsers/response-parser";
import type { AuthSession, ClientOptions, SearchParams } from "../types";
import { getRandomUserAgent, getBrowserHeaders, runtimeRequire } from "../auth/utils";

interface RequestOptions {
  method?: string;
  body?: unknown;
}

export class VintedAPIClient {
  private readonly itemUrls = new TTLCache<string>(300_000, 512);
  private readonly accessCooldowns = new Map<string, number>();
  private readonly readCache = new TTLCache<any>(90_000, 128);
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

  private static readonly MAX_CONSECUTIVE_FAILURES = 10;
  private static readonly MAX_BACKOFF_MS = 60000;
  private static readonly LONG_COOLDOWN_MS = 5 * 60 * 1000;
  private static readonly MAX_REQUESTS_PER_SESSION = 40;

  constructor(options: ClientOptions = {}) {
    this.authMode = options.authMode || "http";
    this.proxies = options.proxies || (options.proxyUrl ? [options.proxyUrl] : []);
    this.httpAuth = new HttpAuth(this.tokenCache, this.proxies.length > 0 ? this.proxies[0] : undefined);
    this.envAuth = new EnvAuth(new TokenCache());
    this.rateLimiter = new RateLimiter(options.maxConcurrency ?? 3, options.requestDelayMs ?? 500, options.jitterMs ?? 300);
    this.maxRetries = options.maxRetries ?? 2;

    if (this.authMode === "playwright") {
      this.cookieFactory = new CookieFactory(this.tokenCache);
    }

    this.playwrightAuth = new PlaywrightAuth(new TokenCache(15 * 60 * 1000));
  }

  async searchItems(params: SearchParams) {
    const url = buildSearchUrl(params);
    const cacheKey = `search:${url}`;
    const cached = this.readCache.get(cacheKey);
    if (cached) return structuredClone(cached);
    const data = await this.makeRequest(url, params.country);
    const parsed = parseSearchResponse(data, params.country, params.page || 1, params.perPage || 24);
    for (const item of parsed.items) this.itemUrls.set(`${params.country}:${item.id}`, item.url);
    this.readCache.set(cacheKey, structuredClone(parsed));
    return parsed;
  }

  /**
   * Vinted removed the item JSON API; the public item page is the only source
   * of detail left, so scrape it and fill the seller block from the user API,
   * which is still alive.
   */
  async getItem(id: number, country: string, sourceUrl?: string) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid item ID");
    country = getCountry(country).code;
    if (sourceUrl) {
      const parsed = new URL(sourceUrl);
      if (parsed.origin !== getBaseUrl(country) || parsed.username || parsed.password || !new RegExp(`^/items/${id}(?:-|$)`).test(parsed.pathname)) throw new Error("Invalid listing source URL");
      this.itemUrls.set(`${country}:${id}`, parsed.href);
    }
    const key = `item:${country}:${id}`;
    const cached = this.readCache.get(key);
    if (cached) return structuredClone(cached);
    const item = await this.scrapeItemPage(id, country);
    if (item.seller.id) {
      try {
        const userData = await this.makeRequest(buildUserUrl(item.seller.id, country), country);
        item.seller = parseSeller(userData.user || userData, country);
      } catch {
        item.sellerLookupStatus = "unavailable";
        console.warn("[vinted-core] Seller lookup unavailable; returning partial item data");
      }
    }
    this.readCache.set(key, structuredClone(item));
    return item;
  }

  async getSeller(id: number, country: string) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid seller ID");
    country = getCountry(country).code;
    const userUrl = buildUserUrl(id, country);
    const feedbacksUrl = buildUserFeedbacksUrl(id, country);
    const wardrobeUrl = buildWardrobeUrl(id, country);

    const fetchSellerData = async (requestFn: (url: string, country: string) => Promise<any>) => {
      const [userData, feedbackData, itemsData] = await Promise.all([
        requestFn(userUrl, country),
        requestFn(feedbacksUrl, country).catch(() => ({ user_feedbacks: [] })),
        requestFn(wardrobeUrl, country).catch(() => ({ items: [] }))
      ]);

      const items = (itemsData.items || []).map((item: any) => parseItem(item, country));

      const raw = userData.user || userData;
      const profile = parseSellerProfile(raw, country);
      const reviews = (feedbackData.user_feedbacks || []).map((feedback: any) => ({
        rating: feedback.rating,
        comment: feedback.feedback || "",
        createdAt: feedback.created_at_ts || null
      }));

      return { ...profile, reviews, items, scrapedAt: new Date().toISOString() };
    };

    if (this.authMode === "playwright" && this.playwrightAuth) {
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
          createdAt: null,
          verifications: { email: false, phone: false, facebook: false, google: false },
          reviews: [],
          items: [],
          scrapedAt: new Date().toISOString()
        };
      }

      throw error;
    }
  }

  /** Needs a logged-in session; Vinted returns an empty wardrobe to anonymous callers. */
  async getSellerItems(id: number, country: string, perPage = 24) {
    const data = await this.makeRequest(buildWardrobeUrl(id, country, 1, perPage), country);
    return (data.items || []).map((item: any) => parseItem(item, country));
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

      const prices = items.map((item: any) => item.price).filter((p: any) => typeof p === "number" && p > 0).sort((a: number, b: number) => a - b);
      if (!prices.length) continue;
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
    const url = buildItemPageUrl(itemId, key);

    try {
      // The item JSON API is gone, so read the current state off the item page
      // with the logged-in session. The toggle endpoint would otherwise unlike
      // an item that is already liked.
      const html = await this.fetchItemPage(itemId, key);
      const likedMatch = html.match(/\\"is_favourite\\":(true|false)/);
      if (!likedMatch) {
        throw new Error("Could not read the item's current favourite state from the item page");
      }

      const wasLiked = likedMatch[1] === "true";
      if (wasLiked !== liked) {
        await this.makeRequest(buildFavouriteToggleUrl(key), key, {
          method: "POST",
          body: { type: "item", user_favourites: [itemId] }
        });
      }

      const titleMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      const title = titleMatch ? (safeJsonParse(titleMatch[1])?.name ?? "") : "";

      return {
        id: itemId,
        title,
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

    const origin = new URL(url).origin;
    if (Date.now() < (this.accessCooldowns.get(origin) || 0)) throw new Error("Vinted rate limited or access restricted; cooldown active, retry later");
    if (this.consecutiveFailures >= VintedAPIClient.MAX_CONSECUTIVE_FAILURES) {
      this.accessCooldowns.set(origin, Date.now() + VintedAPIClient.LONG_COOLDOWN_MS);
      this.consecutiveFailures = 0;
      throw new Error("Vinted requests temporarily stopped after repeated failures; retry later");
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
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
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

      const { response, responseText } = await this.rateLimiter.execute(async () => {
        const response = await fetch(url, fetchOptions as RequestInit);
        const responseText = decodeText(await readBounded(response, 5_000_000));
        return { response, responseText };
      });

      if (response.ok) {
        this.consecutiveFailures = 0;
        return parseJsonBody(responseText);
      }

      const status = response.status;
      const retriable = status === 401 || status === 429 || status === 502 || status === 503 || status === 504;
      if (status === 403 || status === 429) {
        const delay = status === 429 ? parseRetryAfter(response.headers.get("retry-after")) ?? 60_000 : 300_000;
        this.accessCooldowns.set(origin, Date.now() + delay);
        throw new Error(`Vinted access restricted or rate limited (${status}); retry later, no bypass attempted`);
      }

      if (retriable && retryCount < this.maxRetries) {
        this.tokenCache.invalidate(key);
        this.sessionRequestCount.set(key, 0);

        if (this.authMode === "env" && status === 401) {
          this.envAuth.invalidate(key);
        }

        if (status === 401) {
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
        redirect: "error",
        signal: AbortSignal.timeout(15_000)
      })
    );

    this.playwrightAuth.incrementRequestCount(country);

    if (response.ok) {
      return response.json();
    }


    throw new Error(`Vinted API error (playwright): ${response.status} ${response.statusText}`);
  }

  private async fetchItemPage(id: number, country: string): Promise<string> {
    const dispatcher = this.getProxyDispatcher();

    let cookieHeader = "";
    try {
      const session = await this.getSession(country);
      cookieHeader = Object.entries(session.cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join("; ");
    } catch {
      // Item pages load anonymously; a session is a nice-to-have, not required.
    }

    const url = this.itemUrls.get(`${country}:${id}`) || buildItemPageUrl(id, country);
    const origin = new URL(url).origin;
    if (Date.now() < (this.accessCooldowns.get(origin) || 0)) throw new Error("Vinted access restricted or rate limited; retry later");
    return this.rateLimiter.execute(async () => {
      const response = await fetchSameOrigin(url, {
        headers: { "User-Agent": getRandomUserAgent(), Accept: "text/html,application/xhtml+xml", ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
        signal: AbortSignal.timeout(15_000), ...(dispatcher ? { dispatcher } : {})
      } as RequestInit);
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 403 || response.status === 429) this.accessCooldowns.set(origin, Date.now() + (response.status === 429 ? parseRetryAfter(response.headers.get("retry-after")) ?? 60_000 : 300_000));
        throw new Error(`Item page fetch failed: ${response.status}; stopped without bypass attempts`);
      }
      return decodeText(await readBounded(response, 8_000_000));
    });
  }

  /** Read JSON-LD and item-scoped React payload records; never borrow recommendation data. */
  private async scrapeItemPage(id: number, country: string): Promise<any> {
    return parseItemPage(await this.fetchItemPage(id, country), id, country);
  }

  private getProxyDispatcher(): unknown {
    if (!this.proxies || this.proxies.length === 0) {
      return undefined;
    }

    const proxy = this.proxies[0]; // Never rotate proxies in response to access restrictions.

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

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseJsonBody(text: string): any {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON response from Vinted (possibly access restricted)");
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
