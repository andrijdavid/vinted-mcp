import type { VintedAPIClient } from "../vinted-core";
import { boundedText, countryCode, integer, fold } from "./common";
import { Garment, GARMENTS, MEN_CATALOG, garmentTerms, audience, categoryMatches, CATEGORY_SOURCE, isDescendant } from "./catalog";
import { normalizeSize, sizeMatch, titleSize, sizeSystem } from "./size";
import { listingRisk } from "./risk";
import { FEATURES, metadataMatch, mentions, variants, canonical } from "./ranking";

export function mergeListing(base: any, detail: any): any {
  const result = { ...base };
  for (const [key, value] of Object.entries(detail)) {
    if (value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && !value.length)) result[key] = value;
  }
  if (!detail.seller?.username && !detail.seller?.ratingCount && base.seller?.username) result.seller = base.seller;
  return result;
}
export function validateSearch(args: any): any {
  if (!GARMENTS.includes(args.category)) throw new Error(`category must be one of ${GARMENTS.join(", ")}`);
  const country = countryCode(args.country || "fr");
  const reference = { ...(args.reference || {}) };
  for (const key of FEATURES) {
    if (args[key] !== undefined) reference[key] = args[key];
    if (reference[key] !== undefined) boundedText(reference[key], key, true);
  }
  for (const key of ["style", "size"]) if (args[key] !== undefined) boundedText(args[key], key);
  if (args.size && !normalizeSize(args.size)) throw new Error("Unrecognized size; use L, W32, EU46, or ONE SIZE. No cross-system conversions are assumed.");
  if (args.maxPrice !== undefined && (typeof args.maxPrice !== "number" || !Number.isFinite(args.maxPrice) || args.maxPrice < 0)) throw new Error("maxPrice must be a non-negative number");
  for (const field of ["brandPreferences", "exclusions", "strategies", "allowedAlternatives"]) {
    if (args[field] !== undefined && (!Array.isArray(args[field]) || args[field].length > 10)) throw new Error(`${field} must be an array of at most 10 terms`);
    for (const value of args[field] || []) boundedText(value, field, true);
  }
  if (args.sizeIds && (!Array.isArray(args.sizeIds) || args.sizeIds.length > 10 || args.sizeIds.some(v => !Number.isInteger(v) || v <= 0))) throw new Error("sizeIds must contain positive integers");
  if (args.categoryId !== undefined && (!Number.isInteger(args.categoryId) || !isDescendant(args.categoryId, MEN_CATALOG[args.category as Garment]))) throw new Error("categoryId must belong to the requested men's garment category");
  return { ...args, country, reference, limit: integer(args.limit, 8, 5, 12), maxStrategies: integer(args.maxStrategies, 3, 1, 4), enrichLimit: integer(args.enrichLimit, 8, 0, 12) };
}
export function buildStrategies(args: any): string[] {
  const r = args.reference;
  const terms = garmentTerms[args.category as Garment];
  const generated = terms.map((term, i) => [term, ...(i === 0 ? [r.color, r.texture, r.material] : i === 1 ? [r.color, r.fit, r.neckline] : [r.color]).filter(Boolean).map(v => {
    const aliases = variants(v); return aliases[Math.min(i, aliases.length - 1)];
  }), i < 2 ? args.style || "" : "", i < 2 ? (args.brandPreferences || [])[0] || "" : ""].filter(Boolean).join(" "));
  // An alternate query adds recall without weakening mandatory size/category checks.
  const alternates = (args.allowedAlternatives || []).map(term => `${terms[0]} ${term}`);
  return [...new Set([...(args.strategies || []), generated[0], ...alternates, ...generated.slice(1)])].slice(0, args.maxStrategies);
}
export function deduplicate(items: any[]): any[] {
  const seenIds = new Set<string>(), seenPhotos = new Set<string>();
  return items.filter(item => {
    const key = `${item.country}:${item.id}`;
    const photo = item.photos?.[0];
    if (seenIds.has(key) || (photo && seenPhotos.has(photo))) return false;
    seenIds.add(key);
    if (photo) seenPhotos.add(photo);
    return true;
  });
}
export function rejection(item: any, args: any): string | null {
  if (item.isSold || item.availability === "sold" || item.reserved) return "Unavailable listing";
  if (["women", "kids"].includes(audience(item))) return "Wrong audience";
  if (categoryMatches(item, args.category) === false) return "Wrong category";
  if (args.size && sizeMatch(args.size, item.size) === "mismatch") return "Wrong size";
  const titleEvidence = titleSize(item.title || "");
  if (args.size && titleEvidence && sizeSystem(args.size) === sizeSystem(titleEvidence) && sizeMatch(args.size, titleEvidence) === "mismatch") return "Explicit size in title conflicts with requested size";
  if (args.maxPrice !== undefined && item.price != null && item.price > args.maxPrice) return "Over price ceiling";
  const text = fold(`${item.title} ${item.description} ${item.category || ""}`);
  for (const term of args.exclusions || []) if (variants(term).some(v => mentions(text, v))) return `Excluded feature: ${term}`;
  if (canonical(args.reference?.fit || "") === "baggy" && /\b(slim|skinny|strak)\b/.test(text)) return "Slim/skinny conflicts with baggy reference";
  // Conservative model exclusions, not visual observations. Source: https://www.levistrauss.com/wp-content/uploads/2019/01/19_H1_FITGUIDE_1221182.pdf
  if (canonical(args.reference?.fit || "") === "baggy" && /levi/.test(fold(item.brand || item.title)) && /\b(510|511|512|519)\b/.test(fold(item.title))) return "Levi's slim/skinny model conflicts with baggy reference";
  if (canonical(args.reference?.neckline || "") === "crewneck" && /\b(zip|rits|zipper|ritssluiting|hoodie|capuchon|v-neck|v-hals|coltrui)\b/.test(text)) return "Neckline/model conflicts with crewneck reference";
  const meta = metadataMatch(item, args.reference || {}, args.category);
  // Reject explicit conflicting colors except broad shade-family labels.
  const color = meta.criteria.find(c => c.feature === "color");
  if (color?.status === "mismatch" && !((canonical(args.reference.color) === "darkbrown" && variants("brown").some(v => mentions(text, v))) ||
    (canonical(args.reference.color) === "lightbeige" && variants("beige").some(v => mentions(text, v))))) return "Conflicting color metadata";
  return null;
}
export async function searchSimilar(client: VintedAPIClient, input: any): Promise<any> {
  const args = validateSearch(input);
  const strategies = buildStrategies(args);
  const errors: any[] = [], collected: any[] = [];
  let completed = 0;
  const necklace = args.category === "accessory" && /chain|necklace|ketting|collier/.test(fold(args.reference.details));
  const categoryId = args.categoryId || (necklace ? 241 : MEN_CATALOG[args.category as Garment]);
  for (const query of strategies) {
    try {
      const result = await client.searchItems({ query, country: args.country, categoryId, sizeIds: args.sizeIds, priceMax: args.maxPrice, perPage: 30, page: 1, sortBy: "relevance" });
      completed++;
      collected.push(...result.items.map(item => ({ ...item, searchContext: { query, categoryFilterId: categoryId, sizeFilterIds: args.sizeIds || [], sizeVerified: false } })));
    } catch (error) {
      errors.push({ query, error: error instanceof Error ? error.message : "Search failed" });
      if (/403|restricted|429|rate.limit/i.test(errors.at(-1).error)) break;
    }
  }
  const rejected: any[] = [];
  const unique = deduplicate(collected);
  function eligible(item: any): boolean {
    const reason = rejection(item, args);
    if (reason) rejected.push({ itemId: item.id, reason });
    return !reason;
  }
  const preliminary = unique.filter(eligible).map(item => ({ ...item, metadataMatch: metadataMatch(item, args.reference, args.category) }))
    .sort((a, b) => (b.metadataMatch.score || 0) - (a.metadataMatch.score || 0));
  const candidates: any[] = [];
  let detailRestricted = false;
  for (let i = 0; i < preliminary.length && candidates.length < args.limit; i++) {
    let item = preliminary[i];
    if (i < args.enrichLimit && !detailRestricted) {
      try { item = mergeListing(item, await client.getItem(item.id, args.country)); item.detailStatus = "retrieved"; }
      catch (error) {
        item.detailStatus = "unavailable";
        const message = error instanceof Error ? error.message : "Detail unavailable";
        errors.push({ itemId: item.id, error: message });
        if (/403|429|restricted|rate.limit/i.test(message)) detailRestricted = true;
      }
    }
    if (!eligible(item)) continue;
    const sizeStatus = args.size ? sizeMatch(args.size, item.size) : "not_requested";
    item.metadataMatch = metadataMatch(item, args.reference, args.category);
    item.visualMatch = { score: null, status: "not_assessed", reason: "Inspect actual photos with get_item_images, then call assess_visual_match" };
    item.sizeStatus = sizeStatus;
    item.warnings = [...(sizeStatus === "unknown" ? ["Size is unverified; do not recommend as a confirmed size match"] : []),
      ...(item.detailStatus !== "retrieved" ? ["Listing detail not verified in this search"] : []),
      ...(item.availability === "unknown" ? ["Availability unverified"] : []),
      ...(audience(item) === "unknown" ? ["Men's catalog filter applied; listing audience not independently confirmed"] : [])];
    item.sizeOptional = args.category === "accessory" && !args.size;
    item.risk = listingRisk(item, collected);
    item.imageToolArguments = { itemId: item.id, country: args.country, maxPhotos: 3, includeContent: true };
    if (args.brandPreferences?.length) item.brandPreferenceMatch = args.brandPreferences.some(v => fold(v) === fold(item.brand));
    candidates.push(item);
  }
  candidates.sort((a, b) => {
    const penalty = (i: any) => (i.risk.recommendation === "do_not_recommend" ? 1000 : 0) + (i.sizeStatus === "unknown" ? 300 : 0);
    return (b.metadataMatch.score || 0) - penalty(b) - ((a.metadataMatch.score || 0) - penalty(a)) || Number(b.brandPreferenceMatch || 0) - Number(a.brandPreferenceMatch || 0);
  });
  const returned = candidates.slice(0, args.limit);
  // Bound metadata responses too; complete photos remain available through get_item_images.
  const bounded = returned.map(item => ({ ...item, description: String(item.description || "").slice(0, 2000), photos: (item.photos || []).slice(0, 6), photoMetadata: item.photoMetadata?.slice(0, 6) }));
  return { category: args.category, country: args.country, reference: args.reference, requestedSize: args.size || null,
    strategies, completedStrategies: completed, categoryFilterId: categoryId, categorySource: CATEGORY_SOURCE,
    collected: collected.length, deduplicated: unique.length, candidates: bounded, rejected, errors,
    completeness: returned.length >= 5 ? "at_least_five_candidates" : "fewer_than_five_available_after_filters",
    visualAssessment: "not_performed_by_search; real listing image review is required", fetchedAt: new Date().toISOString() };
}
