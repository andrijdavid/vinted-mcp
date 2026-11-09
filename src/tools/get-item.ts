import type { VintedAPIClient } from "../vinted-core";

export const getItemTool = {
  name: "get_item",
  description:
    "Get full details of a Vinted item by ID or URL. Returns price, description, photos and seller info. Vinted removed the item API, so this reads the public item page: it is slower than search and carries no view count or listing date.",
  inputSchema: {
    type: "object",
    properties: {
      itemId: { type: "integer", description: "Vinted item ID" },
      url: { type: "string", description: "Vinted item URL (alternative to itemId)" },
      country: { type: "string", description: "Country code", default: "fr" }
    }
  }
};

export async function handleGetItem(client: VintedAPIClient, args: any): Promise<string> {
  let itemId: number;
  let country: string;

  if (args.url) {
    const parsed = parseItemUrl(args.url);
    if (!parsed) {
      throw new Error(`Invalid Vinted item URL: ${args.url}`);
    }
    itemId = parsed.id;
    country = parsed.country;
  } else if (args.itemId) {
    itemId = args.itemId;
    country = args.country || "fr";
  } else {
    throw new Error("Either itemId or url must be provided");
  }

  const item = await client.getItem(itemId, country, args.url);
  return JSON.stringify(
    {
      id: item.id,
      title: item.title,
      description: item.description,
      price: item.price == null ? null : `${item.price} ${item.currency}`,
      originalPrice: item.originalPrice ? `${item.originalPrice} ${item.currency}` : null,
      brand: item.brand,
      category: item.category,
      size: item.size,
      condition: item.condition,
      color: item.color,
      photos: item.photos,
      photoMetadata: item.photoMetadata,
      materials: item.materials,
      productIdentifiers: item.productIdentifiers,
      dimensions: item.dimensions,
      availability: item.availability,
      source: "vinted",
      scrapedAt: item.scrapedAt,
      favourites: item.favouriteCount,
      isSold: item.isSold,
      url: item.url,
      seller: {
        id: item.seller.id,
        username: item.seller.username,
        rating: item.seller.rating,
        ratingCount: item.seller.ratingCount,
        itemCount: item.seller.itemCount,
        followerCount: item.seller.followerCount,
        profileUrl: item.seller.profileUrl
      }
    },
    null,
    2
  );
}

export function parseItemUrl(url: string): { id: number; country: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) return null;
    const domainMap: Record<string, string> = { fr:"fr", de:"de", "co.uk":"uk", it:"it", es:"es", nl:"nl", pl:"pl", pt:"pt", be:"be", at:"at", lt:"lt", cz:"cz", sk:"sk", hu:"hu", ro:"ro", hr:"hr", fi:"fi", dk:"dk", se:"se" };
    const host = parsed.hostname.match(/^(?:www\.)?vinted\.(.+)$/);
    const item = parsed.pathname.match(/^\/items\/(\d+)(?:-[^/]*)?\/?$/);
    if (!host || !domainMap[host[1]] || !item) return null;
    const id = Number(item[1]);
    return Number.isSafeInteger(id) && id > 0 ? { id, country: domainMap[host[1]] } : null;
  } catch { return null; }
}
