import type { VintedAPIClient } from "../vinted-core";
import { resolveItem } from "./get-item-images";
import { fetchOriginalSource, identifyOriginal, manufacturerDomains, validateProductUrl } from "../visual/product";
import { TTLCache } from "../visual/common";

const cache = new TTLCache<any[]>(15 * 60_000, 32);
export const findOriginalProductTool = {
  name: "find_original_product",
  description: "Identify a possible original product using listing identifiers and optional official manufacturer source URLs. No paid search or AI API required. Without verifiable sources returns not_identified plus queries for ChatGPT browsing. Exact status requires a matching code observed on a real listing label; similarity never confirms identity or authenticity.",
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  inputSchema: { type: "object", properties: {
    itemId: { type: "integer", minimum: 1 }, url: { type: "string" }, country: { type: "string", default: "fr" },
    sourceUrls: { type: "array", items: { type: "string" }, maxItems: 3, description: "Official Zara, Timberland, COS, Uniqlo, H&M, Mango or Levi's product pages discovered through ChatGPT browsing" },
    labelEvidence: { type: "object", properties: { photoUrl: { type: "string" }, observedCode: { type: "string" } }, required: ["photoUrl", "observedCode"] },
    webEvidence: { type: "array", maxItems: 3, description: "Fallback when manufacturer blocks server fetching: facts actually observed by ChatGPT web browsing. Always marked caller-supplied, never enough for exact confirmation.", items: {
      type: "object", properties: {
        sourceUrl: { type: "string" }, name: { type: "string", maxLength: 300 }, brand: { type: "string", maxLength: 100 },
        modelCode: { type: "string", maxLength: 100 }, color: { type: "string", maxLength: 100 }, material: { type: "string", maxLength: 300 },
        observation: { type: "string", maxLength: 1000 },
        photoUrls: { type: "array", maxItems: 6, items: { type: "string" } }
      }, required: ["sourceUrl", "name", "brand", "observation"]
    } }
  } }
};
export async function handleFindOriginalProduct(client: VintedAPIClient, args: any): Promise<string> {
  const { id, country } = resolveItem(args);
  if (args.sourceUrls && (!Array.isArray(args.sourceUrls) || args.sourceUrls.length > 3 || args.sourceUrls.some(v => typeof v !== "string" || v.length > 2000))) throw new Error("sourceUrls must contain at most three URLs");
  const item = await client.getItem(id, country);
  const products: any[] = [], errors: any[] = [];
  if (args.webEvidence && (!Array.isArray(args.webEvidence) || args.webEvidence.length > 3)) throw new Error("At most three browser source observations are allowed");
  for (const entry of args.webEvidence || []) {
    const sourceUrl = validateProductUrl(entry.sourceUrl, item.brand || "").href;
    if (typeof entry.observation !== "string" || !entry.observation.trim() || entry.observation.length > 1000) throw new Error("Browser evidence requires a concise observation");
    products.push({ name: entry.name, brand: entry.brand, modelCode: entry.modelCode || null,
      identifiers: entry.modelCode ? [{ type: "product_code", value: entry.modelCode, source: "caller_web_observation" }] : [],
      color: entry.color || null, material: entry.material || null, specifications: [], originalPrice: null, sourceListedPrice: null,
      sourceUrl, observation: entry.observation, evidenceMethod: "caller_web_observation",
      photos: (entry.photoUrls || []).slice(0, 6).map(url => {
        if (new URL(url).protocol !== "https:") throw new Error("Product photo must use HTTPS");
        return { url, sourceUrl, role: "possible_original_product_not_listing_photo", evidenceMethod: "caller_web_observation" };
      }) });
  }
  for (const url of args.sourceUrls || []) {
    try {
      validateProductUrl(url, item.brand || "");
      const result = cache.get(url) || cache.set(url, await fetchOriginalSource(url, item.brand || ""));
      products.push(...result);
    } catch (error) { errors.push({ url, error: error instanceof Error ? error.message : "Source unavailable" }); }
  }
  const result = identifyOriginal(item, products, args.labelEvidence);
  const domains = manufacturerDomains(item.brand || "");
  const terms = result.identifiers.length ? result.identifiers.map(i => i.value) : [item.title];
  return JSON.stringify({ itemId: id, listingUrl: item.url, ...result, errors,
    searchQueries: domains.flatMap(domain => terms.slice(0, 3).map(term => `site:${domain} "${item.brand}" "${term}"`)),
    nextStep: products.length ? "Review source evidence and variant uncertainty" : "ChatGPT can use its available web search with these queries, then call again with official sourceUrls. If sources are unavailable, retain not_identified.",
    fetchedAt: new Date().toISOString() });
}
