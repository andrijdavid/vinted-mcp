import { TTLCache } from "./common";
import { RateLimiter } from "../vinted-core/api/rate-limiter";
const https = require("node:https");
const dns = require("node:dns").promises;
const net = require("node:net");
const Buffer = require("node:buffer").Buffer;

export function publicHttps(value: string): URL {
  const u = new URL(value);
  if (value.length > 2000 || u.protocol !== "https:" || u.username || u.password ||
      (u.port && u.port !== "443") || net.isIP(u.hostname.replace(/^\[|\]$/g, "")) ||
      !u.hostname.includes(".") || /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname)) throw new Error("Public HTTPS hostname required");
  u.hash = "";
  return u;
}
export function publicIPv4(ip: string): boolean {
  if (net.isIP(ip) !== 4) return false;
  const [a, b] = ip.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 || a === 192 && [0, 168].includes(b) ||
    a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19, 51].includes(b) || a === 203 && b === 0);
}
export interface ExternalBody { bytes: Uint8Array; mime: string; retrievedAt: string; }
export type ExternalTransport = (url: string, maxBytes: number, headers?: Record<string, string>) => Promise<ExternalBody>;

/** No proxy, browser, cookies or redirects. Resolve under a deadline, validate ALL answers,
 * then pin the socket lookup to the checked IPv4 address (TLS still verifies the hostname).
 * IPv6-only sources fail closed. The deadline includes DNS, headers and streamed body. */
export const pinnedHttps: ExternalTransport = (value, maxBytes, headers = {}) => new Promise((resolve, reject) => {
  let req: any, settled = false;
  const finish = (error?: Error, result?: ExternalBody) => {
    if (settled) return;
    settled = true; clearTimeout(timer);
    if (error) { req?.destroy(); reject(error); } else resolve(result!);
  };
  const timer = setTimeout(() => finish(new Error("External source timed out (10s)")), 10_000);
  (async () => {
    const url = publicHttps(value);
    const answers = await dns.lookup(url.hostname, { all: true, family: 4, verbatim: true });
    if (settled) return;
    if (!answers.length || answers.some(a => !publicIPv4(a.address))) throw new Error("Unsafe DNS address");
    req = https.get(url, { headers: { "User-Agent": "VintedProductReferences/1.0", "Accept-Encoding": "identity", ...headers },
      family: 4, agent: false, lookup: (_host: any, options: any, callback: any) =>
        options?.all ? callback(null, [{ address: answers[0].address, family: 4 }]) : callback(null, answers[0].address, 4)
    }, response => {
      const status = response.statusCode || 0;
      if (status !== 200) { response.destroy(); finish(new Error(`External source HTTP ${status}; no redirect, retry or bypass attempted`)); return; }
      if (Number(response.headers["content-length"]) > maxBytes || response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
        response.destroy(); finish(new Error("External source exceeds byte limit or uses unsupported encoding")); return;
      }
      const mime = String(response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!(headers.Accept || "").split(",").includes(mime)) { response.destroy(); finish(new Error("External source MIME not accepted")); return; }
      const chunks: any[] = []; let size = 0;
      response.on("data", chunk => { size += chunk.length; if (size > maxBytes) { response.destroy(); finish(new Error("External source exceeds byte limit")); } else chunks.push(chunk); });
      response.on("error", finish);
      response.on("aborted", () => finish(new Error("External response aborted")));
      response.on("end", () => finish(undefined, { bytes: Buffer.concat(chunks), mime, retrievedAt: new Date().toISOString() }));
    });
    req.on("error", finish);
  })().catch(finish);
});

/** Shared across tools: bounded cache, in-flight deduplication, rate limits and origin cooldowns. */
export class ReferenceHttp {
  private cache = new TTLCache<ExternalBody>(15 * 60_000, 48);
  private pending = new Map<string, Promise<ExternalBody>>();
  private cooldown = new TTLCache<string>(60_000, 48);
  private limiter = new RateLimiter(2, 350, 0);
  constructor(private transport: ExternalTransport = pinnedHttps) {}
  async get(value: string, kind: "page" | "image" | "search" | "product_json", headers: Record<string, string> = {}): Promise<ExternalBody> {
    const url = publicHttps(value), key = `${kind}:${url.href}`;
    const cached = this.cache.get(key); if (cached) return cached;
    if (this.pending.has(key)) return this.pending.get(key)!;
    const work = this.limiter.execute(async () => {
      if (this.cooldown.get(url.origin)) throw new Error("External origin in access cooldown; retry later");
      try {
        const response = await this.transport(url.href, kind === "image" ? 4_000_000 : 2_000_000,
          { Accept: kind === "image" ? "image/jpeg,image/png,image/webp" : kind === "page" ? "text/html,application/xhtml+xml" : kind === "product_json" ? "application/json,text/javascript,application/javascript" : "application/json", ...headers });
        const allowed = kind === "image" ? ["image/jpeg", "image/png", "image/webp"] : kind === "page" ? ["text/html", "application/xhtml+xml"] : kind === "product_json" ? ["application/json", "text/javascript", "application/javascript"] : ["application/json"];
        if (!allowed.includes(response.mime) || response.bytes.length > (kind === "image" ? 4_000_000 : 2_000_000)) throw new Error("External response MIME or byte limit invalid");
        return this.cache.set(key, response);
      } catch (error) {
        if (/HTTP (403|429|503)/.test(String(error))) this.cooldown.set(url.origin, "restricted");
        throw error;
      }
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, work); return work;
  }
}
