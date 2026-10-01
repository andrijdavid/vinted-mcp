import { getApiBaseUrl, getBaseUrl, getCountry } from "../models/country";
import type { SearchParams } from "../types";

const SORT_MAP: Record<string, string> = {
  relevance: "relevance",
  price_low_to_high: "price_low_to_high",
  price_high_to_low: "price_high_to_low",
  newest_first: "newest_first"
};

const CONDITION_MAP: Record<string, number> = {
  new_with_tags: 6,
  new_without_tags: 1,
  very_good: 2,
  good: 3,
  satisfactory: 4
};

/**
 * Vinted retired www.vinted.<tld>/api/v2/catalog/items in favour of
 * api.vinted.<tld>/svc-catalogue/items. Filters only apply in the bracketed
 * attribute_ids[...] form; the old flat brand_ids/size_ids/status_ids names
 * still return 200 but are silently ignored. price_from/price_to/order/page/
 * per_page/user_id stay flat.
 */
export function buildSearchUrl(params: SearchParams): string {
  const url = new URL(`${getApiBaseUrl(params.country)}/svc-catalogue/items`);

  if (params.query) {
    url.searchParams.set("search_text", params.query);
  }
  if (params.categoryId) {
    url.searchParams.set("attribute_ids[catalog]", String(params.categoryId));
  }
  if (params.brandIds?.length) {
    url.searchParams.set("attribute_ids[brand]", params.brandIds.join(","));
  }
  if (params.priceMin !== undefined) {
    url.searchParams.set("price_from", String(params.priceMin));
  }
  if (params.priceMax !== undefined) {
    url.searchParams.set("price_to", String(params.priceMax));
  }
  if (params.sizeIds?.length) {
    url.searchParams.set("attribute_ids[size]", params.sizeIds.join(","));
  }
  if (params.condition?.length) {
    const conditionIds = params.condition.map((c) => CONDITION_MAP[c]).filter(Boolean);
    url.searchParams.set("attribute_ids[status]", conditionIds.join(","));
  }
  url.searchParams.set("order", SORT_MAP[params.sortBy || "relevance"] || "relevance");
  url.searchParams.set("page", String(params.page || 1));
  url.searchParams.set("per_page", String(params.perPage || 24));
  url.searchParams.set("currency", getCountry(params.country).currency);

  return url.toString();
}

export function buildItemPageUrl(itemId: number, country: string): string {
  return `${getBaseUrl(country)}/items/${itemId}`;
}

export function buildUserUrl(userId: number, country: string): string {
  return `${getBaseUrl(country)}/api/v2/users/${userId}`;
}

/** The seller's own listings; returns an empty list unless the session is logged in. */
export function buildWardrobeUrl(userId: number, country: string, page = 1, perPage = 24): string {
  return `${getBaseUrl(country)}/api/v2/wardrobe/${userId}/items?page=${page}&per_page=${perPage}`;
}

export function buildUserFeedbacksUrl(userId: number, country: string, page = 1, perPage = 10): string {
  return `${getBaseUrl(country)}/api/v2/user_feedbacks?user_id=${userId}&page=${page}&per_page=${perPage}`;
}

export function buildFavouriteToggleUrl(country: string): string {
  return `${getBaseUrl(country)}/api/v2/user_favourites/toggle`;
}
