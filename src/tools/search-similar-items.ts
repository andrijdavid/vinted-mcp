import type { VintedAPIClient } from "../vinted-core";
import { GARMENTS } from "../visual/catalog";
import { FEATURES } from "../visual/ranking";
import { searchSimilar } from "../visual/search";
import { enrichSelectedReferences, lazyReferenceProperties, lazyReferenceDefinitions } from "./find-product-reference-images";

export const referenceSchema = { type: "object", additionalProperties: false, properties: Object.fromEntries(FEATURES.map(key => [key, { type: "string", maxLength: 300 }])) };
export const similarProperties = {
  ...lazyReferenceProperties,
  category: { type: "string", enum: [...GARMENTS], description: "Men's garment family; official catalog filtering is always applied" },
  reference: referenceSchema,
  ...referenceSchema.properties,
  style: { type: "string", maxLength: 300 }, size: { type: "string", description: "Exact label such as L, W32, EU46; no inferred conversions" },
  country: { type: "string", default: "fr" }, maxPrice: { type: "number", minimum: 0 },
  sizeIds: { type: "array", items: { type: "integer", minimum: 1 }, maxItems: 10, description: "Known Vinted size IDs; never guessed. Exact label is also checked locally." },
  categoryId: { type: "integer", description: "Optional more specific category within the requested men's family" },
  brandPreferences: { type: "array", items: { type: "string" }, maxItems: 10 },
  exclusions: { type: "array", items: { type: "string" }, maxItems: 10 },
  allowedAlternatives: { type: "array", items: { type: "string" }, maxItems: 10 },
  strategies: { type: "array", items: { type: "string", maxLength: 300 }, maxItems: 4, description: "Optional language-specific queries, prioritized before generated NL/EN/FR strategies" },
  limit: { type: "integer", minimum: 5, maximum: 12, default: 8 },
  enrichLimit: { type: "integer", minimum: 0, maximum: 12, default: 8 },
  maxStrategies: { type: "integer", minimum: 1, maximum: 4, default: 3 }
};
export const searchSimilarItemsTool = {
  name: "search_similar_items", description: "Find men's clothing candidates using bounded multilingual searches, official categories, exact size checks, deduplication, metadata relevance, real photo URLs and seller/condition risk. Does NOT claim visual similarity until actual photos are inspected. Fewer than five eligible results is reported explicitly.",
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  inputSchema: { type: "object", $defs: lazyReferenceDefinitions, properties: similarProperties, required: ["category"] }
};
export async function handleSearchSimilarItems(client: VintedAPIClient, args: any): Promise<string> {
  const result = await searchSimilar(client, args);
  await enrichSelectedReferences(client, result.candidates, { ...args, country: result.country });
  return JSON.stringify(result);
}
