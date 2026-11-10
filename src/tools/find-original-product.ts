import type { VintedAPIClient } from "../vinted-core";
import { resolveItem } from "./get-item-images";
import { identifyOriginal, normalizeBrand } from "../visual/product";
import { sourceInfo, loadProductPage, referenceQueries } from "../visual/reference-sources";
import { referenceService, classifyReference } from "../visual/references";
import { publicHttps } from "../visual/reference-network";
import { referenceEvidenceProperties } from "./find-product-reference-images";
import { productProfile } from "../visual/product-profile";

export const findOriginalProductTool = {
  name: "find_original_product",
  description: "Identify an original product from listing codes, brand/model/color and official, retailer or archive sources. Legacy status/candidate fields are retained; identificationStatus adds strict exact_verified/probable_same_product/similar_reference/not_found. Exact needs a code actually observed on a listing label plus fetched reliable source and color agreement. Browser-only facts cannot establish exact identity. Call find_product_reference_images for validated on-model media. No mandatory paid API.",
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  inputSchema: { type: "object", properties: {
    itemId: { type: "integer", minimum: 1 }, url: { type: "string" }, country: { type: "string", default: "fr" },
    ...referenceEvidenceProperties,
    includeReferenceImages: { type: "boolean", default: false }
  } }
};
export async function handleFindOriginalProduct(client: VintedAPIClient, args: any): Promise<string> {
  const { id, country } = resolveItem(args);
  const listing = await client.getItem(id, country, args.url);
  const profile = productProfile(listing);
  const item = { ...listing, model: profile.model, collection: profile.collection };
  // Validate label provenance even with no available sources.
  identifyOriginal(item, [], args.labelEvidence);
  if (args.sourceUrls && (!Array.isArray(args.sourceUrls) || args.sourceUrls.length > 6)) throw new Error("At most six source URLs");
  if (args.webEvidence && (!Array.isArray(args.webEvidence) || args.webEvidence.length > 6)) throw new Error("At most six browser observations");
  (args.sourceUrls || []).forEach(sourceInfo);
  const products: any[] = [], errors: any[] = [];
  for (const entry of args.webEvidence || []) {
    const source = sourceInfo(entry.sourceUrl);
    if (source.officialBrand && normalizeBrand(source.officialBrand) !== normalizeBrand(entry.brand)) throw new Error("Browser brand contradicts official domain");
    if (typeof entry.observation !== "string" || !entry.observation.trim() || entry.observation.length > 1000) throw new Error("Browser evidence requires a concise actual observation");
    products.push({ name: entry.name, brand: entry.brand, model: entry.model || null, modelCode: entry.modelCode || null,
      identifiers: entry.modelCode ? [{ type: "product_code", value: entry.modelCode, source: "caller_web_observation" }] : [],
      color: entry.color || null, material: entry.material || null, specifications: [], originalPrice: null, sourceListedPrice: null,
      sourceUrl: source.url, source, observation: entry.observation, evidenceMethod: "caller_web_observation",
      photos: (entry.photoUrls || []).slice(0, 6).map(url => ({ url: publicHttps(url).href, sourceUrl: source.url,
        role: "possible_original_product_not_listing_photo", evidenceMethod: "caller_web_observation", downloadValidated: false })) });
  }
  for (const url of args.sourceUrls || []) {
    try { products.push(...await loadProductPage(url, referenceService.http)); }
    catch (error) { errors.push({ url, error: error instanceof Error ? error.message : "Source unavailable" }); }
  }
  const result = identifyOriginal(item, products, args.labelEvidence);
  const legacy = { exact_verified: "exact_product_confirmed", probable_same_product: "probable_same_model", similar_reference: "similar_product_only" };
  for (const candidate of result.candidates) {
    const identification = classifyReference(item, candidate, args.labelEvidence);
    candidate.identificationStatus = identification.status;
    candidate.status = legacy[identification.status];
    candidate.confidence = identification.status === "exact_verified" ? "high_identifier_agreement" : identification.status === "probable_same_product" ? "moderate" : "low";
    candidate.uncertainty = identification.uncertainty;
    candidate.matchedIdentifiers = identification.matchedIdentifiers;
  }
  const rank = { exact_product_confirmed: 0, probable_same_model: 1, similar_product_only: 2 };
  result.candidates.sort((a, b) => rank[a.status] - rank[b.status] || a.source.tier.localeCompare(b.source.tier));
  result.status = result.candidates[0]?.status || "not_identified";
  const queries = referenceQueries(item, result.identifiers);
  const references = args.includeReferenceImages ? await referenceService.find(item, { ...args, includeContent: false }) : null;
  return JSON.stringify({ itemId: id, listingUrl: item.url, ...result, listingProductProfile: profile,
    identificationStatus: result.candidates[0]?.identificationStatus || "not_found", errors,
    searchQueries: queries.filter(q => q.purpose === "identity").map(q => q.query), searchPlan: queries,
    ...(references ? { referenceImages: references.referenceImages, productReference: references } : {}),
    referenceImageToolArguments: { itemId: id, country, preferOnModel: true },
    nextStep: "Use ChatGPT web search with these queries and return verified sourceUrls/webEvidence. Use find_product_reference_images for source-bound and download-validated media; browser-only observations stay unconfirmed.",
    fetchedAt: new Date().toISOString() });
}
