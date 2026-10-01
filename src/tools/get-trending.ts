import type { VintedAPIClient } from "../vinted-core";

export const getTrendingTool = {
  name: "get_trending",
  description:
    "Find recently listed Vinted items ranked by engagement (favourites, then views). Note: the catalogue API no longer returns listing timestamps or view counts, so the ranking is coarse and favourite counts are often 0 on promoted results.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search keywords (optional)" },
      country: { type: "string", description: "Country code", default: "fr" },
      categoryId: { type: "integer", description: "Category ID filter" },
      limit: { type: "integer", description: "Max items to return", default: 20 }
    }
  }
};

export async function handleGetTrending(client: VintedAPIClient, args: any): Promise<string> {
  const country = args.country || "fr";
  const limit = Math.min(args.limit || 20, 100);

  const result = await client.searchItems({
    query: args.query,
    country,
    categoryId: args.categoryId,
    sortBy: "newest_first",
    perPage: Math.min(limit * 2, 48),
    page: 1
  });

  const trending = result.items
    .map((item: any) => ({
      id: item.id,
      title: item.title,
      price: `${item.price} ${item.currency}`,
      brand: item.brand,
      favourites: item.favouriteCount || 0,
      views: item.viewCount || 0,
      url: item.url
    }))
    .sort((a: any, b: any) => b.favourites - a.favourites || b.views - a.views)
    .slice(0, limit);

  return JSON.stringify(
    {
      country,
      query: args.query || null,
      note: "Ranked by favourites then views; Vinted no longer exposes listing age or view counts in search results.",
      trendingItems: trending
    },
    null,
    2
  );
}
