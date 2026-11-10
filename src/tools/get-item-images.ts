import type { VintedAPIClient } from "../vinted-core";
import { parseItemUrl } from "./get-item";
import { countryCode, integer } from "../visual/common";
import { ListingImageLoader } from "../visual/images";
import { photoMetadata } from "../visual/photos";

export const getItemImagesTool = {
  name: "get_item_images",
  description: "Retrieve real Vinted listing photos with provenance. includeContent returns bounded MCP image or embedded resource blocks. A URL alone is NOT visual evidence. If your host cannot see image blocks, export the same photos and ask the user to attach them; never claim visual assessment from text.",
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  inputSchema: { type: "object", properties: {
    itemId: { type: "integer", minimum: 1 }, url: { type: "string" }, country: { type: "string", default: "fr" },
    maxPhotos: { type: "integer", minimum: 1, maximum: 6, default: 3 },
    includeContent: { type: "boolean", default: false },
    contentFormat: { type: "string", enum: ["image", "resource"], default: "image" }
  } }
};
export function resolveItem(args: any): { id: number; country: string } {
  if (args.url) {
    const parsed = parseItemUrl(args.url);
    if (!parsed) throw new Error("Invalid Vinted item URL");
    if (args.country && countryCode(args.country) !== parsed.country) throw new Error("Country conflicts with listing URL");
    return parsed;
  }
  if (!Number.isSafeInteger(args.itemId) || args.itemId <= 0) throw new Error("Provide a positive itemId or Vinted listing URL");
  return { id: args.itemId, country: countryCode(args.country || "fr") };
}
export async function handleGetItemImages(client: VintedAPIClient, args: any, loader = new ListingImageLoader()): Promise<any> {
  const { id, country } = resolveItem(args);
  const max = integer(args.maxPhotos, 3, 1, 6);
  if (args.contentFormat && !["image", "resource"].includes(args.contentFormat)) throw new Error("Unsupported contentFormat");
  const item = await client.getItem(id, country, args.url);
  const photos = (item.photoMetadata || photoMetadata(item, id, item.url, item.scrapedAt)).slice(0, max);
  const blocks: any[] = [];
  const warnings: string[] = [];
  const images: any[] = [];
  let bytes = 0;
  for (let index = 0; index < photos.length; index++) {
    const photo = photos[index];
    const uri = `vinted://image/${country}/${id}/${index}`;
    const entry: any = { ...photo, resourceUri: uri, contentIncluded: false };
    if (args.includeContent) {
      if (index >= 3) { warnings.push("Inline content limited to first three photos; remaining URLs retain provenance"); images.push(entry); continue; }
      try {
        const image = await loader.load(photo.url);
        bytes += image.bytes;
        if (bytes > 900_000) throw new Error("Aggregate image byte limit reached");
        Object.assign(entry, { contentIncluded: true, contentIndex: blocks.length + 1, mimeType: image.mimeType, width: image.width, height: image.height, bytes: image.bytes, fetchedAt: image.fetchedAt });
        blocks.push(args.contentFormat === "resource" ? { type: "resource", resource: { uri, mimeType: image.mimeType, blob: image.data } } :
          { type: "image", mimeType: image.mimeType, data: image.data });
      } catch (error) {
        entry.error = error instanceof Error ? error.message : "Image unavailable";
      }
    }
    images.push(entry);
  }
  if (!photos.length) warnings.push("No listing photos available; visual assessment is unavailable");
  const data = { itemId: id, listingUrl: item.url, country, images, warnings,
    referenceImageToolArguments: { itemId: id, country, preferOnModel: true },
    visualAccess: args.includeContent && blocks.length ? "image_bytes_returned_host_visibility_unverified" : "metadata_only",
    fallback: "Use scripts/export-item-images.cjs to save these exact listing photos for attachment in ChatGPT. Inspect only attached or visibly received images." };
  return { structuredContent: data, content: [{ type: "text", text: JSON.stringify(data) }, ...blocks] };
}
