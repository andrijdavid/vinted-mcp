/** Strict host policies keep tool inputs away from local services and arbitrary URLs. */
export function allowedImageUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
      !/^images\d*\.vinted\.net$/.test(url.hostname)) throw new Error("Only HTTPS Vinted listing image CDN URLs are allowed");
  return url;
}
export async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) { await response.body?.cancel(); throw new Error("Response exceeds byte limit"); }
  if (!response.body) throw new Error("Empty response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) { await reader.cancel(); throw new Error("Response exceeds byte limit"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
  return bytes;
}
export const decodeText = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** Vinted canonicalizes /items/ID to /items/ID-slug. Only same-origin GET redirects are allowed. */
export async function fetchSameOrigin(url: string, init: RequestInit, fetcher: typeof fetch = fetch): Promise<Response> {
  const origin = new URL(url).origin;
  for (let redirects = 0; ; redirects++) {
    const response = await fetcher(url, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    await response.body?.cancel();
    const next = new URL(response.headers.get("location") || "", url);
    if (redirects >= 2 || !response.headers.get("location") || next.origin !== origin || next.username || next.password || (init.method && init.method !== "GET")) throw new Error("Unsafe or excessive redirect");
    url = next.href;
  }
}
