import { countryCode, integer } from "../visual/common";
import { mergeListing } from "../visual/search";
import { sizeMatch } from "../visual/size";
import type { VintedAPIClient } from "../vinted-core";

export const searchItemsTool = {
  name: "search_items",
  description:
    "Search Vinted items with filters. Returns items with price, photos, seller info. Supports 19 countries.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search keywords" },
      includePhotos: { type: "boolean", default: false },
      includeDimensions: { type: "boolean", default: false },
      includeSellerSummary: { type: "boolean", default: false },
      includeMaterials: { type: "boolean", default: false },
      includeProductIdentifiers: { type: "boolean", default: false },
      page: { type: "integer", minimum: 1, maximum: 100, default: 1 },
      perPage: { type: "integer", minimum: 1, maximum: 100 },
      sizeIds: { type: "array", items: { type: "integer", minimum: 1 } },
      size: { type: "string", description: "Optional exact size label. Mismatches are removed; unknown sizes are explicitly flagged." },
      country: {
        type: "string",
        description: "Country code (fr, de, uk, it, es, nl, pl, pt, be, at, lt, cz, sk, hu, ro, hr, fi, dk, se)",
        default: "fr"
      },
      priceMin: { type: "number", description: "Minimum price filter" },
      priceMax: { type: "number", description: "Maximum price filter" },
      brandIds: { type: "array", items: { type: "integer" }, description: "Filter by brand IDs" },
      categoryId: { type: "integer", description: "Vinted category ID filter" },
      condition: {
        type: "array",
        items: { type: "string" },
        description: "Condition filter (new_with_tags, new_without_tags, very_good, good, satisfactory)"
      },
      sortBy: {
        type: "string",
        enum: ["relevance", "price_low_to_high", "price_high_to_low", "newest_first"],
        description: "Sort order"
      },
      limit: { type: "integer", description: "Max items to return (max 100)", default: 20 }
    },
    required: ["query"]
  }
};

export async function handleSearchItems(client: VintedAPIClient, args: any): Promise<string> {
  const params = {
    query: args.query,
    country: countryCode(args.country || "fr"),
    sizeIds: args.sizeIds,
    categoryId: args.categoryId,
    brandIds: args.brandIds,
    priceMin: args.priceMin,
    priceMax: args.priceMax,
    condition: args.condition,
    sortBy: args.sortBy || "relevance",
    perPage: args.perPage === undefined ? Math.min(integer(args.limit, 20, 1, 10000), 100) : integer(args.perPage, 20, 1, 100),
    page: integer(args.page, 1, 1, 100)
  };

  if (typeof args.query !== "string" || args.query.length > 300) throw new Error("query must be text up to 300 characters");
  const result = await client.searchItems(params);
  const errors: any[] = [];
  const items = [...result.items];
  const enrich = args.includeDimensions || args.includeMaterials || args.includeProductIdentifiers || args.includeSellerSummary;
  if (enrich) for (let i = 0; i < Math.min(items.length, 10); i++) {
    try { items[i] = mergeListing(items[i], await client.getItem(items[i].id, params.country)); }
    catch (error) { errors.push({ itemId: items[i].id, error: error instanceof Error ? error.message : "Detail unavailable" }); }
  }
  const summary = items.filter(item => !args.size || sizeMatch(args.size, item.size) !== "mismatch").map((item: any) => ({
    id: item.id,
    title: item.title,
    price: item.price == null ? null : `${item.price} ${item.currency}`,
    priceAmount: item.price,
    currency: item.currency || null,
    category: item.category,
    categoryId: item.categoryId,
    color: item.color,
    sizeSystem: item.sizeSystem || null,
    ...(args.size ? { sizeStatus: sizeMatch(args.size, item.size) } : {}),
    ...(args.includePhotos ? { photos: item.photos, photoMetadata: item.photoMetadata } : {}),
    ...(args.includeDimensions ? { dimensions: item.dimensions || null } : {}),
    ...(args.includeMaterials ? { materials: item.materials || [] } : {}),
    ...(args.includeProductIdentifiers ? { productIdentifiers: item.productIdentifiers || [] } : {}),
    ...(args.includeSellerSummary ? { sellerSummary: item.seller } : {}),
    availability: item.availability || "unknown",
    source: "vinted",
    fetchedAt: item.scrapedAt,
    brand: item.brand,
    condition: item.condition,
    size: item.size,
    favourites: item.favouriteCount,
    url: item.url,
    seller: item.seller.username
  }));

  return JSON.stringify(
    {
      totalFound: result.totalCount,
      returned: summary.length,
      country: params.country,
      items: summary,
      page: params.page, perPage: params.perPage, hasMore: result.hasMore,
      enrichment: enrich ? { maxDetailedItems: 10, errors, note: "Requested fields beyond the first ten may be unknown" } : undefined
    },
    null,
    2
  );
}
