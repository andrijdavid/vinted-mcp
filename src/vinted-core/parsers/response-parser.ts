import { money, textValue } from "../../visual/common";
import { isCondition, normalizeSize, sizeSystem } from "../../visual/size";
import { extractIdentifiers } from "../../visual/identifiers";
import { photoMetadata, PhotoMetadata } from "../../visual/photos";
import { getBaseUrl } from "../models/country";

export interface ParsedSeller {
  id: number;
  username: string;
  rating: number | null;
  ratingCount: number;
  itemCount: number;
  followerCount: number;
  lastSeenAt: string | null;
  country: string;
  profileUrl: string;
}

export interface ParsedItem {
  id: number;
  url: string;
  title: string;
  description: string;
  price: number | null;
  currency: string;
  originalPrice: number | null;
  country: string;
  brand: string | null;
  brandId: number | null;
  category: string | null;
  categoryId: number | null;
  size: string | null;
  condition: string | null;
  color: string | null;
  photos: string[];
  photoMetadata?: PhotoMetadata[];
  materials?: string[];
  dimensions?: Record<string, unknown> | null;
  productIdentifiers?: ReturnType<typeof extractIdentifiers>;
  sizeSystem?: string | null;
  source?: string;
  availability?: "available" | "sold" | "unknown";
  favouriteCount: number;
  viewCount: number;
  isSold: boolean;
  soldAt: string | null;
  createdAt: string;
  updatedAt: string;
  seller: ParsedSeller;
  scrapedAt: string;
}

export function parseItem(raw: any, country: string): ParsedItem {
  const baseUrl = getBaseUrl(country);
  const seller = raw.user || raw.seller || {};
  // svc-catalogue results carry no structured brand/size/condition. They only
  // exist baked into item_box's display strings: first_line is the brand,
  // second_line is "size · condition".
  const box = raw.item_box || raw.itemBox || {};
  const lines = String(box.second_line || box.secondLine || "").split(/\s*[·•]\s*/);
  const boxSize = lines.find(v => normalizeSize(v));
  const boxCondition = lines.find(v => isCondition(v));
  const url = toAbsoluteUrl(raw.url, baseUrl) || `${baseUrl}/items/${raw.id}`;
  const retrievedAt = new Date().toISOString();
  const photos = photoMetadata(raw, raw.id, url, retrievedAt);
  const rawSize = textValue(raw.size_title || raw.size);
  const size = rawSize && !isCondition(rawSize) ? rawSize : boxSize || null;
  const sold = raw.is_closed === true || raw.is_sold === true || raw.status === "sold";
  const statusCondition = typeof raw.status === "string" && (isCondition(raw.status) || ["new_with_tags", "new_without_tags", "very_good", "good", "satisfactory"].includes(raw.status)) ? raw.status : null;

  return {
    id: raw.id,
    url,
    title: raw.title || "",
    description: raw.description || "",
    price: money(raw.price?.amount ?? raw.price ?? raw.priceWithDiscount?.amount ?? raw.total_item_price?.amount),
    currency: raw.price?.currency_code || raw.price?.currencyCode || raw.currency || "",
    originalPrice: money(raw.original_price?.amount ?? raw.original_price),
    country,
    brand: textValue(raw.brand_title || raw.brand || box.first_line || box.firstLine),
    brandId: raw.brand_id || raw.brand_dto?.id || null,
    category: textValue(raw.catalog_title || raw.category),
    categoryId: raw.catalog_id || raw.category_id || null,
    size,
    sizeSystem: sizeSystem(size),
    condition: textValue(raw.status_title || raw.condition || statusCondition) || boxCondition || null,
    color: textValue(raw.color1) || textValue(raw.color),
    materials: (Array.isArray(raw.materials) ? raw.materials : [raw.material]).map(textValue).filter(Boolean) as string[],
    dimensions: raw.dimensions && typeof raw.dimensions === "object" ? raw.dimensions : null,
    productIdentifiers: extractIdentifiers(raw),
    source: "vinted",
    availability: sold ? "sold" : raw.is_closed === false || raw.is_sold === false ? "available" : "unknown",
    photos: photos.map(p => p.url),
    photoMetadata: photos,
    favouriteCount: raw.favourite_count || raw.favorites_count || 0,
    viewCount: raw.view_count || 0,
    isSold: sold,
    soldAt: raw.closed_at || raw.sold_at || null,
    createdAt: raw.created_at_ts || raw.created_at || "",
    updatedAt: raw.updated_at_ts || raw.updated_at || raw.created_at_ts || "",
    seller: parseSeller(seller, country),
    scrapedAt: retrievedAt
  };
}

/** Vinted reports feedback_reputation as a 0-1 fraction; callers expect stars. */
function toStars(reputation: unknown): number | null {
  const value = parseFloat(String(reputation));
  if (!Number.isFinite(value)) {
    return null;
  }
  return value >= 0 && value <= 1 ? Math.round(value * 5 * 10) / 10 : null;
}

function toAbsoluteUrl(url: unknown, baseUrl: string): string {
  if (typeof url !== "string" || !url) {
    return "";
  }
  try { const parsed = new URL(url, baseUrl); return parsed.protocol === "https:" && parsed.hostname === new URL(baseUrl).hostname ? parsed.href : ""; } catch { return ""; }
}

export function parseSeller(raw: any, country: string): ParsedSeller {
  const baseUrl = getBaseUrl(country);
  return {
    id: raw.id || 0,
    username: raw.login || raw.username || "",
    rating: raw.feedback_reputation != null ? toStars(raw.feedback_reputation) : (typeof raw.rating === "number" && raw.rating >= 0 && raw.rating <= 5 ? raw.rating : null),
    ratingCount: raw.feedback_count || raw.rating_count || 0,
    itemCount: raw.item_count || raw.items_count || 0,
    followerCount: raw.followers_count || raw.follower_count || 0,
    lastSeenAt: raw.last_loged_on_ts || raw.last_seen_at || null,
    country,
    profileUrl: raw.profile_url || `${baseUrl}/member/${raw.id}-${raw.login || ""}`
  };
}

export function parseSellerProfile(raw: any, country: string) {
  const baseUrl = getBaseUrl(country);
  return {
    id: raw.id,
    username: raw.login || raw.username || "",
    profileUrl: raw.profile_url || `${baseUrl}/member/${raw.id}-${raw.login || ""}`,
    rating: raw.feedback_reputation != null ? toStars(raw.feedback_reputation) : (typeof raw.rating === "number" && raw.rating >= 0 && raw.rating <= 5 ? raw.rating : null),
    ratingCount: raw.feedback_count || 0,
    itemCount: raw.item_count || raw.items_count || 0,
    soldItemCount: raw.given_item_count || raw.sold_item_count || 0,
    followerCount: raw.followers_count || 0,
    followingCount: raw.following_count || 0,
    country,
    city: raw.city || null,
    lastSeenAt: raw.last_loged_on_ts || null,
    createdAt: raw.created_at || null,
    verifications: {
      email: raw.verification?.email?.valid || false,
      phone: raw.verification?.phone?.valid || false,
      facebook: raw.verification?.facebook?.valid || false,
      google: raw.verification?.google?.valid || false
    }
  };
}

export function parseSearchResponse(raw: any, country: string, page: number, perPage: number) {
  const items = (raw.items || []).map((item: any) => parseItem(item, country));
  return {
    items,
    totalCount: raw.pagination?.total_entries || raw.total_count || items.length,
    page,
    perPage,
    hasMore: items.length >= perPage
  };
}
