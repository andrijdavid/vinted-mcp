import { TokenCache } from "./token-cache";
import { browserArgs } from "./playwright-auth";
import { getBaseUrl, getCountry } from "../models/country";
import type { AuthSession } from "../types";
import { runtimeRequire } from "./utils";

const SESSION_TTL_MS = 15 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const LOGIN_POLL_MS = 2000;

interface CurrentUser {
  id: number;
  username: string;
}

export function profileDir(country: string): string {
  const path = require("path") as { join: (...parts: string[]) => string };
  const os = require("os") as { homedir: () => string };
  const root = process.env.VINTED_PROFILE_DIR?.trim() || path.join(os.homedir(), ".vinted-mcp");
  return path.join(root, `profile-${country.toLowerCase()}`);
}

export function hasProfile(country: string): boolean {
  const fs = require("fs") as { existsSync: (path: string) => boolean };
  return fs.existsSync(profileDir(country));
}

export function loginHint(country: string): string {
  return `Not logged in for '${country}'. Run: npx @andrijdavid/vinted-mcp login --country ${country}`;
}

/**
 * Reads cookies from a persistent Chromium profile created by `vinted-mcp login`.
 * The browser refreshes its own tokens, so the session stays valid without the
 * user ever copying anything out of DevTools.
 */
export class ProfileAuth {
  constructor(private readonly tokenCache: TokenCache = new TokenCache(SESSION_TTL_MS)) {}

  async createSession(country: string): Promise<AuthSession> {
    const key = country.toLowerCase();
    const cached = this.tokenCache.get(key);
    if (cached) {
      return cached;
    }

    if (!hasProfile(key)) {
      throw new Error(loginHint(key));
    }

    const context = await openContext(key, true);

    try {
      const page = await context.newPage();
      await page.goto(getBaseUrl(key), { waitUntil: "domcontentloaded", timeout: 30000 });

      const user = await fetchCurrentUser(page, key);
      if (!user) {
        throw new Error(loginHint(key));
      }

      const session = await readSession(context, page, key, user);
      this.tokenCache.set(key, session);
      return session;
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  invalidate(country: string): void {
    this.tokenCache.invalidate(country.toLowerCase());
  }
}

/**
 * Opens a visible browser window and waits until the user is signed in.
 * Whatever the user does in there (password, captcha, 2FA, social login) is
 * fine; all we need afterwards is the profile directory on disk.
 */
export async function loginInteractive(country: string): Promise<CurrentUser> {
  const key = country.toLowerCase();
  const baseUrl = getBaseUrl(key);
  const context = await openContext(key, false);

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    console.error(`Sign in to ${baseUrl} in the browser window. This closes automatically once you are logged in.`);

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (page.isClosed()) {
        throw new Error("Browser was closed before login completed");
      }

      const user = await fetchCurrentUser(page, key);
      if (user) {
        console.error(`Logged in as ${user.username || user.id}. Profile saved to ${profileDir(key)}`);
        return user;
      }

      await sleep(LOGIN_POLL_MS);
    }

    throw new Error(`Timed out after ${LOGIN_TIMEOUT_MS / 1000}s waiting for login`);
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function openContext(country: string, headless: boolean): Promise<any> {
  const playwright = runtimeRequire("playwright") as { chromium?: any };
  if (!playwright?.chromium) {
    throw new Error("Playwright is required for profile login. Install it with: npm i playwright && npx playwright install chromium");
  }

  const fs = require("fs") as { mkdirSync: (path: string, options: Record<string, unknown>) => void };
  const dir = profileDir(country);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  return playwright.chromium.launchPersistentContext(dir, {
    headless,
    locale: getCountry(country).language,
    userAgent: desktopUserAgent(),
    viewport: { width: 1280, height: 900 },
    args: browserArgs()
  });
}

async function fetchCurrentUser(page: any, country: string): Promise<CurrentUser | null> {
  try {
    return await page.evaluate(async (base: string) => {
      const res = await fetch(`${base}/api/v2/users/current`, {
        credentials: "include",
        headers: { Accept: "application/json" }
      });

      if (!res.ok) {
        return null;
      }

      const data = await res.json();
      const user = data?.user || data;
      if (!user || !user.id) {
        return null;
      }

      return { id: user.id, username: user.login || user.username || "" };
    }, getBaseUrl(country));
  } catch {
    // Page navigating or closed mid-poll; treat as not-yet-logged-in.
    return null;
  }
}

async function readSession(context: any, page: any, country: string, user: CurrentUser): Promise<AuthSession> {
  const cookies: Record<string, string> = {};
  for (const cookie of await context.cookies()) {
    cookies[cookie.name] = cookie.value;
  }

  let csrfToken = "";
  try {
    csrfToken = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="csrf-token"]');
      return meta?.getAttribute("content") || "";
    });
  } catch {
    csrfToken = "";
  }

  if (!csrfToken) {
    csrfToken = cookies.csrf_token || cookies._csrf_token || "";
  }

  return {
    accessToken: cookies.access_token_web || cookies.access_token || "",
    cookies,
    csrfToken,
    country,
    expiresAt: Date.now() + SESSION_TTL_MS,
    userId: user.id,
    username: user.username
  };
}

// ponytail: fixed per-platform UA so the headed login and the headless refresh
// look like the same browser; headless Chromium otherwise reports HeadlessChrome.
function desktopUserAgent(): string {
  const chrome = "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  if (process.platform === "darwin") {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${chrome}`;
  }
  if (process.platform === "win32") {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${chrome}`;
  }
  return `Mozilla/5.0 (X11; Linux x86_64) ${chrome}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
