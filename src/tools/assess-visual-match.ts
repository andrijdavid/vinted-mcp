import type { VintedAPIClient } from "../vinted-core";
import { resolveItem } from "./get-item-images";
import { metadataMatch, visualMatch, FEATURES } from "../visual/ranking";
import { GARMENTS } from "../visual/catalog";
import { referenceSchema } from "./search-similar-items";

export const visualReviewSchema = { type: "object", properties: {
  observer: { type: "string", enum: ["chatgpt_vision", "user_image_review"] },
  referenceImage: { type: "string", description: "Actual upload/file identifier or reference image URL that the observer inspected" },
  candidateImageUrls: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" }, description: "Listing photo URLs actually inspected" },
  comparisons: { type: "array", maxItems: 10, items: { type: "object", properties: {
    feature: { type: "string", enum: [...FEATURES] }, status: { type: "string", enum: ["match", "close", "mismatch", "unknown"] },
    explanation: { type: "string", maxLength: 500 }
  }, required: ["feature", "status", "explanation"] } }
}, required: ["observer", "referenceImage", "candidateImageUrls", "comparisons"] };
export const assessVisualMatchTool = {
  name: "assess_visual_match", description: "Compute an explainable approximate visual score ONLY from actual image observations supplied by ChatGPT or the user. First inspect the reference upload and real listing photos. Cite both. The server validates listing photo provenance and weights observations; it has no vision model. Without review visual score is null; metadata relevance remains separate.",
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  inputSchema: { type: "object", properties: {
    itemId: { type: "integer", minimum: 1 }, url: { type: "string" }, country: { type: "string", default: "fr" },
    category: { type: "string", enum: [...GARMENTS] }, reference: referenceSchema, review: visualReviewSchema
  }, required: ["category", "reference"] }
};
export async function handleAssessVisualMatch(client: VintedAPIClient, args: any): Promise<string> {
  const { id, country } = resolveItem(args);
  if (!GARMENTS.includes(args.category) || !args.reference || typeof args.reference !== "object") throw new Error("Provide category and reference features");
  const item = await client.getItem(id, country);
  return JSON.stringify({ itemId: id, metadataMatch: metadataMatch(item, args.reference, args.category), visualMatch: visualMatch(item, args.reference, args.category, args.review) });
}
