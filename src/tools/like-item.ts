import { parseItemUrl } from "./get-item";
import type { VintedAPIClient } from "../vinted-core";

export const likeItemTool = {
  name: "like_item",
  description:
    "Add a Vinted item to your favourites (or remove it with unlike). Requires a logged-in session: run 'npx @andrijdavid/vinted-mcp login' once.",
  inputSchema: {
    type: "object",
    properties: {
      itemId: { type: "integer", description: "Vinted item ID" },
      url: { type: "string", description: "Vinted item URL (alternative to itemId)" },
      country: { type: "string", description: "Country code", default: "fr" },
      unlike: { type: "boolean", description: "Remove the item from favourites instead of adding it", default: false }
    }
  }
};

export async function handleLikeItem(client: VintedAPIClient, args: any): Promise<string> {
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

  const result = await client.setFavourite(itemId, country, !args.unlike);
  return JSON.stringify(result, null, 2);
}
