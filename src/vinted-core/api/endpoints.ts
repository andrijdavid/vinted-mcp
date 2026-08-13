import { getBaseUrl } from "../models/country";
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

export function buildSearchUrl(params: SearchParams): string {
  const base = getBaseUrl(params.country);
  const url = new URL(`${base}/api/v2/catalog/items`);

  if (params.query) {
    url.searchParams.set("search_text", params.query);
  }
  if (params.categoryId) {
    url.searchParams.set("catalog_ids", String(params.categoryId));
  }
  if (params.brandIds?.length) {
    url.searchParams.set("brand_ids", params.brandIds.join(","));
  }
  if (params.priceMin !== undefined) {
    url.searchParams.set("price_from", String(params.priceMin));
  }
  if (params.priceMax !== undefined) {
    url.searchParams.set("price_to", String(params.priceMax));
  }
  if (params.sizeIds?.length) {
    url.searchParams.set("size_ids", params.sizeIds.join(","));
  }
  if (params.condition?.length) {
    const conditionIds = params.condition.map((c) => CONDITION_MAP[c]).filter(Boolean);
    url.searchParams.set("status_ids", conditionIds.join(","));
  }
  if (params.userId) {
    url.searchParams.set("user_id", String(params.userId));
  }
  if (params.isSold) {
    url.searchParams.set("disabled_personalization", "true");
  }

  url.searchParams.set("order", SORT_MAP[params.sortBy || "relevance"] || "relevance");
  url.searchParams.set("page", String(params.page || 1));
  url.searchParams.set("per_page", String(params.perPage || 24));

  return url.toString();
}

export function buildItemUrl(itemId: number, country: string): string {
  return `${getBaseUrl(country)}/api/v2/items/${itemId}`;
}

export function buildUserUrl(userId: number, country: string): string {
  return `${getBaseUrl(country)}/api/v2/users/${userId}`;
}

export function buildUserItemsUrl(userId: number, country: string, page = 1, perPage = 24): string {
  const base = getBaseUrl(country);
  return `${base}/api/v2/users/${userId}/items?page=${page}&per_page=${perPage}`;
}

export function buildFavouriteToggleUrl(country: string): string {
  return `${getBaseUrl(country)}/api/v2/user_favourites/toggle`;
}

export function buildSimilarItemsUrl(itemId: number, country: string): string {
  return `${getBaseUrl(country)}/api/v2/items/${itemId}/similar_items`;
}
