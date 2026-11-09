import { TTLCache } from "./common";
import { allowedImageUrl, readBounded } from "./network";
import { RateLimiter } from "../vinted-core/api/rate-limiter";

const sharp = require("sharp");
sharp.concurrency(2);
sharp.cache({ memory: 16, files: 0, items: 32 });
const Buffer = require("node:buffer").Buffer;
export interface ImagePayload { data: string; mimeType: "image/jpeg"; width: number; height: number; bytes: number; sourceUrl: string; fetchedAt: string; }
export class ListingImageLoader {
  private cache = new TTLCache<ImagePayload>(10 * 60_000, 32);
  private pending = new Map<string, Promise<ImagePayload>>();
  private limiter = new RateLimiter(2, 250, 50);
  constructor(private fetcher: typeof fetch = fetch) {}
  async load(url: string): Promise<ImagePayload> {
    allowedImageUrl(url);
    const cached = this.cache.get(url);
    if (cached) return cached;
    const pending = this.pending.get(url);
    if (pending) return pending;
    const promise = this.limiter.execute(() => this.download(url)).then(v => this.cache.set(url, v)).finally(() => this.pending.delete(url));
    this.pending.set(url, promise);
    return promise;
  }
  private async download(url: string): Promise<ImagePayload> {
    let response: Response;
    for (let attempt = 0; ; attempt++) {
      response = await this.fetcher(url, { redirect: "error", signal: AbortSignal.timeout(10_000), headers: { Accept: "image/jpeg,image/png,image/webp" } });
      if (![429, 502, 503, 504].includes(response.status) || attempt >= 1) break;
      await response.body?.cancel();
      // Respect a long Retry-After by stopping, never retry earlier than requested.
      const retry = response.headers.get("retry-after");
      const delay = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())) : 1000;
      if (!Number.isFinite(delay) || delay > 3000) throw new Error("Image CDN rate limited; retry later");
      await new Promise(r => setTimeout(r, delay));
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Image unavailable (${response.status})`); }
    const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime || "")) { await response.body?.cancel(); throw new Error("Unsupported image MIME type"); }
    const input = Buffer.from(await readBounded(response, 4_000_000));
    const metadata = await sharp(input, { limitInputPixels: 20_000_000, animated: false }).metadata();
    const expected = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" }[mime!];
    if (metadata.format !== expected || (metadata.pages || 1) > 1) throw new Error("Image format mismatch or animated content");
    const output = await sharp(input, { limitInputPixels: 20_000_000 }).rotate().resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer({ resolveWithObject: true });
    if (output.data.length > 300_000) throw new Error("Resized image exceeds response limit");
    return { data: output.data.toString("base64"), mimeType: "image/jpeg", width: output.info.width, height: output.info.height,
      bytes: output.data.length, sourceUrl: url, fetchedAt: new Date().toISOString() };
  }
}
