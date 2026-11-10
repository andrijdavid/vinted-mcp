export interface PhotoMetadata {
  url: string;
  thumbnailUrl: string | null;
  highResolutionUrl: string | null;
  width: number | null;
  height: number | null;
  source: "vinted_listing";
  itemId: number;
  listingUrl: string;
  retrievedAt: string;
}
export function photoMetadata(raw: any, itemId: number, listingUrl: string, retrievedAt: string): PhotoMetadata[] {
  const photos = [raw.photos, raw.photo_urls, raw.photoUrls].find(v => Array.isArray(v) && v.length) || (raw.photo ? [raw.photo] : []);
  const list = Array.isArray(photos) ? photos : [photos];
  return [...new Map<string, PhotoMetadata>(list.map((p: any) => {
    if (!p || typeof p !== "object" && typeof p !== "string") return null;
    const url = typeof p === "string" ? p : p.url || p.full_size_url || p.fullSizeUrl || p.thumbnails?.[0]?.url;
    if (typeof url !== "string" || !/^https:\/\//i.test(url)) return null;
    const thumbs = Array.isArray(p.thumbnails) ? p.thumbnails : [];
    const smallest = [...thumbs].sort((a, b) => (a.width || Infinity) - (b.width || Infinity))[0];
    const largest = [...thumbs].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    return [url, { url, thumbnailUrl: smallest?.url || null, highResolutionUrl: p.full_size_url || p.fullSizeUrl || largest?.url || url,
      width: positive(p.width), height: positive(p.height), source: "vinted_listing", itemId, listingUrl, retrievedAt }] as [string, PhotoMetadata];
  }).filter(Boolean) as [string, PhotoMetadata][]).values()];
}
function positive(value: any): number | null { return Number.isFinite(value) && value > 0 ? value : null; }
