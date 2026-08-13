import type { VintedAPIClient } from "../vinted-core";

export const getItemTool = {
  name: "get_item",
  description: "Get full details of a Vinted item by ID or URL. Returns price, description, photos, seller info.",
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

  const item = await client.getItem(itemId, country);
  return JSON.stringify(
    {
      id: item.id,
      title: item.title,
      description: item.description,
      price: `${item.price} ${item.currency}`,
      originalPrice: item.originalPrice ? `${item.originalPrice} ${item.currency}` : null,
      brand: item.brand,
      category: item.category,
      size: item.size,
      condition: item.condition,
      color: item.color,
      photos: item.photos,
      favourites: item.favouriteCount,
      views: item.viewCount,
      isSold: item.isSold,
      createdAt: item.createdAt,
      url: item.url,
      seller: {
        username: item.seller.username,
        rating: item.seller.rating,
        ratingCount: item.seller.ratingCount,
        itemCount: item.seller.itemCount,
        profileUrl: item.seller.profileUrl
      }
    },
    null,
    2
  );
}

export function parseItemUrl(url: string): { id: number; country: string } | null {
  const match = url.match(/vinted\.(\w+(?:\.\w+)?)\/.*?(\d+)/);
  if (!match) {
    return null;
  }

  const domainMap: Record<string, string> = {
    fr: "fr",
    de: "de",
    "co.uk": "uk",
    it: "it",
    es: "es",
    nl: "nl",
    pl: "pl",
    pt: "pt",
    be: "be",
    at: "at",
    lt: "lt",
    cz: "cz",
    sk: "sk",
    hu: "hu",
    ro: "ro",
    hr: "hr",
    fi: "fi",
    dk: "dk",
    se: "se"
  };

  return {
    id: parseInt(match[2], 10),
    country: domainMap[match[1]] || "fr"
  };
}
