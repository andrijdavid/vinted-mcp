import type { VintedAPIClient } from "../vinted-core";
import { searchSimilar, validateSearch } from "../visual/search";
import { countryCode } from "../visual/common";
import { getCountry } from "../vinted-core/models/country";
import { optimizeOutfit, validateCosts } from "../visual/budget";
import { visualMatch } from "../visual/ranking";
import { similarProperties } from "./search-similar-items";
import { visualReviewSchema } from "./assess-visual-match";

export const findSimilarOutfitTool = {
  name: "find_similar_outfit", description: "Coordinate 1..8 men's outfit parts, exact requested sizes, real listings/photos, risk checks and bounded budget combinations. First interpret the user's actual uploaded outfit photo in ChatGPT. Descriptions alone are metadata fixtures. Inspect candidates with get_item_images and optionally call again with visualReviews. Without image review, outfits remain provisional. Unknown fees never become exact totals. Never buys or messages sellers.",
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  inputSchema: { type: "object", properties: {
    country: { type: "string", default: "nl" }, budget: { type: "number", minimum: 0 },
    referenceImage: { type: "string", description: "Identifier of the actual reference image ChatGPT inspected; omit for explicitly metadata-only work" },
    components: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", properties: { id: { type: "string", maxLength: 80 }, ...similarProperties }, required: ["id", "category"] } },
    costEstimates: { type: "object", additionalProperties: false, properties: {
      shippingPerSeller: { type: "number", minimum: 0 }, buyerProtectionFixedPerItem: { type: "number", minimum: 0 },
      buyerProtectionPercent: { type: "number", minimum: 0, maximum: 100 }, bundleDiscountPercent: { type: "number", minimum: 0, maximum: 100 }
    } },
    visualReviews: { type: "array", maxItems: 96, items: { type: "object", properties: { componentId: { type: "string" }, itemId: { type: "integer" }, review: visualReviewSchema }, required: ["componentId", "itemId", "review"] } }
  }, required: ["components", "budget"] }
};
export async function handleFindSimilarOutfit(client: VintedAPIClient, args: any): Promise<string> {
  const country = countryCode(args.country || "nl");
  if (!Array.isArray(args.components) || args.components.length < 1 || args.components.length > 8) throw new Error("Provide 1..8 components");
  if (typeof args.budget !== "number" || !Number.isFinite(args.budget) || args.budget < 0) throw new Error("budget must be non-negative");
  if (args.components.some(p => typeof p.id !== "string" || !p.id || p.id.length > 80) || new Set(args.components.map(p => p.id)).size !== args.components.length) throw new Error("Components require unique text IDs");
  validateCosts(args.costEstimates);
  // Validate every part before making any requests.
  const inputs = args.components.map(part => validateSearch({ ...part, country }));
  const reviews = args.visualReviews || [];
  if (!Array.isArray(reviews) || reviews.length > 96) throw new Error("Too many visual reviews");
  if (reviews.length && !args.referenceImage) throw new Error("Visual reviews require the actual referenceImage identifier");
  if (reviews.some(r => !args.components.some(p => p.id === r.componentId) || r.review?.referenceImage !== args.referenceImage)) throw new Error("Visual reviews must match the component and reference image");
  const parts: any[] = [];
  const appliedReviews = new Set<any>();
  for (let i = 0; i < inputs.length; i++) {
    const result = await searchSimilar(client, inputs[i]);
    for (const candidate of result.candidates) {
      const review = reviews.find(r => r.componentId === args.components[i].id && r.itemId === candidate.id);
      if (review) { candidate.visualMatch = visualMatch(candidate, inputs[i].reference, inputs[i].category, review.review); appliedReviews.add(review); }
    }
    result.candidates.sort((a, b) => (b.visualMatch.score ?? b.metadataMatch.score ?? 0) - (a.visualMatch.score ?? a.metadataMatch.score ?? 0));
    parts.push({ id: args.components[i].id, ...result });
  }
  const optimized = optimizeOutfit(parts, args.budget, getCountry(country).currency, args.costEstimates);
  // Full candidate data lives once in parts; combinations reference it compactly.
  for (const combination of optimized.combinations) combination.items = combination.items.map((i: any) => ({ componentId: i.componentId, itemId: i.id, title: i.title, url: i.url, price: i.price, currency: i.currency, size: i.size, sizeStatus: i.sizeStatus, photos: i.photos.slice(0, 2), metadataScore: i.metadataMatch.score, visualScore: i.visualMatch.score, risk: i.risk.level }));
  return JSON.stringify({ referenceImage: args.referenceImage || null, referenceMode: args.referenceImage ? "caller_interpreted_reference_image" : "metadata_fixture_no_reference_image", country,
    appliedVisualReviews: appliedReviews.size, unusedVisualReviews: reviews.filter(r => !appliedReviews.has(r)).map(r => ({ componentId: r.componentId, itemId: r.itemId, reason: "Listing not present in current bounded search candidates" })),
    parts, ...optimized, nextStep: "Inspect actual candidate photos and reference image, submit evidence-backed visualReviews, review seller and condition flags, then verify final checkout fees. No automatic purchase or seller messages." });
}
