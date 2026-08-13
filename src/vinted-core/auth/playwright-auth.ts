import { TokenCache } from "./token-cache";
import { getBaseUrl, getCountry } from "../models/country";
import type { AuthSession } from "../types";
import { runtimeRequire } from "./utils";

const MOBILE_DEVICE = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true
};

const CF_WAIT_TIMEOUT = 15000;
const SESSION_TTL_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_SESSION = 25;

interface SessionData {
  session: AuthSession;
  requestCount: number;
  userAgent: string;
}

export class PlaywrightAuth {
  private readonly sessionData = new Map<string, SessionData>();

  constructor(private readonly tokenCache: TokenCache = new TokenCache(SESSION_TTL_MS)) {}

  async createSession(country: string): Promise<AuthSession> {
    const key = country.toLowerCase();
    const existing = this.sessionData.get(key);

    if (existing && existing.requestCount < MAX_REQUESTS_PER_SESSION) {
      const cached = this.tokenCache.get(key);
      if (cached) {
        return cached;
      }
    }

    const session = await this.grabCookies(country);
    this.sessionData.set(key, {
      session,
      requestCount: 0,
      userAgent: MOBILE_DEVICE.userAgent
    });
    this.tokenCache.set(key, session);
    return session;
  }

  incrementRequestCount(country: string): void {
    const entry = this.sessionData.get(country.toLowerCase());
    if (entry) {
      entry.requestCount += 1;
    }
  }

  getUserAgent(country: string): string {
    return this.sessionData.get(country.toLowerCase())?.userAgent || MOBILE_DEVICE.userAgent;
  }

  private async grabCookies(country: string): Promise<AuthSession> {
    const playwright = runtimeRequire("playwright") as { chromium?: any };
    if (!playwright.chromium) {
      throw new Error("Playwright chromium launcher is unavailable");
    }

    const countryInfo = getCountry(country);
    const baseUrl = getBaseUrl(country);

    const browser = await playwright.chromium.launch({
      headless: true,
      args: browserArgs()
    });

    try {
      const context = await browser.newContext({
        ...MOBILE_DEVICE,
        locale: countryInfo.language,
        timezoneId: getTimezone(country)
      });

      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        delete (navigator as any).__proto__.webdriver;
      });

      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await this.waitForCFClearance(page, context);

      const consentSelectors = [
        '[data-testid="cookie-consent-accept"]',
        "#onetrust-accept-btn-handler",
        'button[id*="accept"]',
        ".cookie-consent-accept"
      ];

      for (const selector of consentSelectors) {
        const btn = page.locator(selector).first();
        const isVisible = await btn.isVisible({ timeout: 1000 }).catch(() => false);
        if (isVisible) {
          await btn.click({ timeout: 2000 }).catch(() => undefined);
          await page.waitForTimeout(500);
          break;
        }
      }

      const allCookies = await context.cookies();
      const cookies: Record<string, string> = {};
      for (const cookie of allCookies) {
        cookies[cookie.name] = cookie.value;
      }

      let csrfToken = "";
      try {
        csrfToken = await page.evaluate(() => {
          const meta = document.querySelector('meta[name="csrf-token"]');
          return meta?.getAttribute("content") || "";
        });
      } catch {
        csrfToken = cookies.csrf_token || cookies._csrf_token || "";
      }

      if (!csrfToken) {
        csrfToken = cookies.csrf_token || cookies._csrf_token || "";
      }

      if (!cookies.cf_clearance) {
        console.warn("[playwright-auth] No cf_clearance cookie obtained; Cloudflare may still block requests");
      }

      return {
        accessToken: cookies.access_token_web || cookies.access_token || "",
        cookies,
        csrfToken,
        country: country.toLowerCase(),
        expiresAt: Date.now() + SESSION_TTL_MS
      };
    } finally {
      await browser.close();
    }
  }

  private async waitForCFClearance(page: any, context: any): Promise<void> {
    const started = Date.now();

    while (Date.now() - started < CF_WAIT_TIMEOUT) {
      const cookies = await context.cookies();
      if (cookies.some((cookie: any) => cookie.name === "cf_clearance")) {
        return;
      }

      const isChallenge = await page
        .evaluate(() => {
          return Boolean(
            document.querySelector("#challenge-running") ||
              document.querySelector("#challenge-form") ||
              document.querySelector(".cf-browser-verification") ||
              document.title.includes("Just a moment")
          );
        })
        .catch(() => false);

      if (!isChallenge) {
        await page.waitForTimeout(1000);
        return;
      }

      await page.waitForTimeout(500);
    }

    console.warn("[playwright-auth] Cloudflare challenge did not resolve in time; continuing");
  }
}

export function browserArgs(): string[] {
  if (process.platform === "linux") {
    return [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled"
    ];
  }

  return ["--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"];
}

function getTimezone(country: string): string {
  const tzMap: Record<string, string> = {
    fr: "Europe/Paris",
    de: "Europe/Berlin",
    uk: "Europe/London",
    it: "Europe/Rome",
    es: "Europe/Madrid",
    nl: "Europe/Amsterdam",
    pl: "Europe/Warsaw",
    pt: "Europe/Lisbon",
    be: "Europe/Brussels",
    at: "Europe/Vienna",
    lt: "Europe/Vilnius",
    cz: "Europe/Prague",
    sk: "Europe/Bratislava",
    hu: "Europe/Budapest",
    ro: "Europe/Bucharest",
    hr: "Europe/Zagreb",
    fi: "Europe/Helsinki",
    dk: "Europe/Copenhagen",
    se: "Europe/Stockholm"
  };

  return tzMap[country.toLowerCase()] || "Europe/Paris";
}
