import type { VintedAPIClient } from "../vinted-core";

export const getSellerTool = {
  name: "get_seller",
  description: "Get seller profile, stats, recent reviews and recent items from Vinted. Rating is on a 0-5 scale.",
  inputSchema: {
    type: "object",
    properties: {
      sellerId: { type: "integer", description: "Vinted seller/user ID" },
      url: { type: "string", description: "Vinted seller profile URL (alternative to sellerId)" },
      country: { type: "string", description: "Country code", default: "fr" },
      includeItems: {
        type: "boolean",
        description: "Include the seller's listings. Vinted returns an empty wardrobe to anonymous callers, so this needs a logged-in session (vinted-mcp login).",
        default: true
      },
      itemLimit: { type: "integer", description: "Max items to include", default: 20 }
    }
  }
};

export async function handleGetSeller(client: VintedAPIClient, args: any): Promise<string> {
  let sellerId: number;
  let country: string;

  if (args.url) {
    const parsed = parseSellerUrl(args.url);
    if (!parsed) {
      throw new Error(`Invalid Vinted seller URL: ${args.url}`);
    }
    sellerId = parsed.id;
    country = parsed.country;
  } else if (args.sellerId) {
    sellerId = args.sellerId;
    country = args.country || "fr";
  } else {
    throw new Error("Either sellerId or url must be provided");
  }

  const seller = await client.getSeller(sellerId, country);
  const result: any = {
    id: seller.id,
    username: seller.username,
    profileUrl: seller.profileUrl,
    rating: seller.rating,
    ratingCount: seller.ratingCount,
    itemCount: seller.itemCount,
    soldItemCount: seller.soldItemCount,
    followerCount: seller.followerCount,
    followingCount: seller.followingCount,
    country: seller.country,
    city: seller.city,
    verifications: seller.verifications,
    recentReviews: seller.reviews.slice(0, 5)
  };

  if (seller.createdAt) {
    result.memberSince = seller.createdAt;
  }

  if (args.includeItems !== false) {
    result.recentItems = seller.items.slice(0, args.itemLimit || 20).map((item: any) => ({
      id: item.id,
      title: item.title,
      price: `${item.price} ${item.currency}`,
      brand: item.brand,
      url: item.url
    }));
  }

  return JSON.stringify(result, null, 2);
}

function parseSellerUrl(url: string): { id: number; country: string } | null {
  const match = url.match(/vinted\.(\w+(?:\.\w+)?)\/member\/(\d+)/);
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
