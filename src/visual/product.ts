import { extractIdentifiers } from "./identifiers";
import { fold, textValue, money } from "./common";
import { readBounded, decodeText } from "./network";

const BRANDS: Record<string, string[]> = { zara: ["zara.com"], timberland: ["timberland.com", "timberland.nl", "timberland.eu", "timberland.co.uk"],
  cos: ["cos.com"], uniqlo: ["uniqlo.com"], "h&m": ["hm.com"], mango: ["mango.com"], "levi's": ["levi.com", "levis.com"], levis: ["levi.com", "levis.com"] };
export function manufacturerDomains(brand: string): string[] { return BRANDS[fold(brand)] || []; }
export function validateProductUrl(value: string, brand: string): URL {
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./, "");
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
      !manufacturerDomains(brand).some(d => host === d || host.endsWith(`.${d}`))) throw new Error("Product source must be a supported official manufacturer HTTPS URL for this brand");
  return url;
}
export function parseOriginalProducts(html: string, sourceUrl: string): any[] {
  const products: any[] = [];
  function visit(v: any): void {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (v["@type"] === "Product" || Array.isArray(v["@type"]) && v["@type"].includes("Product")) products.push(v);
    if (v["@graph"]) visit(v["@graph"]);
    if (v.hasVariant) visit(v.hasVariant);
    if (v.itemListElement) visit(v.itemListElement);
    if (v.item) visit(v.item);
  }
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(m[1])); } catch { /* no unverified text extraction as product facts */ }
  }
  return products.slice(0, 10).map(p => {
    const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
    const images = (Array.isArray(p.image) ? p.image : [p.image]).map(i => typeof i === "string" ? i : i?.url).filter(Boolean)
      .map(url => { try { const u = new URL(url, sourceUrl); return u.protocol === "https:" ? u.href : null; } catch { return null; } }).filter(Boolean);
    return { name: textValue(p.name), brand: textValue(p.brand), modelCode: textValue(p.sku || p.mpn || p.model),
      identifiers: extractIdentifiers(p), color: textValue(p.color), material: textValue(p.material),
      specifications: (p.additionalProperty || []).slice?.(0, 20) || [],
      sourceListedPrice: money(offer?.price) == null ? null : { amount: money(offer.price), currency: offer.priceCurrency || null, kind: "manufacturer_offer_price_at_fetch_time" },
      originalPrice: null,
      photos: images.slice(0, 6).map(url => ({ url, sourceUrl, role: "possible_original_product_not_listing_photo" })), sourceUrl,
      evidenceMethod: "server_fetched_jsonld" };
  });
}
export async function fetchOriginalSource(url: string, brand: string, fetcher: typeof fetch = fetch): Promise<any[]> {
  const checked = validateProductUrl(url, brand);
  const response = await fetcher(checked.href, { redirect: "error", signal: AbortSignal.timeout(10_000), headers: { Accept: "text/html" } });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Manufacturer source unavailable (${response.status}); no bypass attempted`); }
  if (!response.headers.get("content-type")?.includes("text/html")) { await response.body?.cancel(); throw new Error("Manufacturer source is not HTML"); }
  return parseOriginalProducts(decodeText(await readBounded(response, 2_000_000)), checked.href);
}
const normalizeCode = (s: string): string => fold(s).replace(/[^a-z0-9]/g, "");
export function identifyOriginal(item: any, products: any[], labelEvidence?: any): any {
  const identifiers = [...(item.productIdentifiers || extractIdentifiers(item))];
  if (labelEvidence && (!item.photos?.includes(labelEvidence.photoUrl) || typeof labelEvidence.observedCode !== "string" ||
      !/^[A-Z0-9][A-Z0-9/-]{4,24}$/i.test(labelEvidence.observedCode) || !/\d/.test(labelEvidence.observedCode))) throw new Error("Label evidence must cite an actual listing photo and a plausible observed product identifier");
  if (labelEvidence && !identifiers.some(i => normalizeCode(i.value) === normalizeCode(labelEvidence.observedCode))) {
    identifiers.push({ type: "product_code", value: labelEvidence.observedCode, source: "caller_observed_listing_label" });
  }
  const candidates = products.map(product => {
    const brandMatch = fold(item.brand) && fold(product.brand) === fold(item.brand);
    const matching = identifiers.filter(i => product.identifiers.some(p => normalizeCode(p.value) === normalizeCode(i.value)));
    const colorConflict = item.color && product.color && fold(item.color) !== fold(product.color);
    const exact = brandMatch && matching.length > 0 && labelEvidence && !colorConflict && product.evidenceMethod === "server_fetched_jsonld";
    const status = exact ? "exact_product_confirmed" : brandMatch && matching.length && !colorConflict ? "probable_same_model" : "similar_product_only";
    return { ...product, status, confidence: exact ? "high_identifier_agreement" : status === "probable_same_model" ? "moderate" : "low",
      matchedIdentifiers: matching, uncertainty: [
        ...(!matching.length ? ["No shared product identifier"] : []), ...(!brandMatch ? ["Brand not confirmed"] : []),
        ...(!labelEvidence ? ["Seller-provided identifier has not been visually confirmed on a label"] : []),
        ...(product.evidenceMethod === "caller_web_observation" ? ["Source facts were observed by ChatGPT browsing; server could not independently fetch them"] : []),
        ...(colorConflict ? ["Color labels differ; variant unresolved"] : []),
        "Identifier agreement cannot authenticate an item or prove the seller owns the original product" ] };
  }).sort((a, b) => b.matchedIdentifiers.length - a.matchedIdentifiers.length);
  return { status: candidates[0]?.status || "not_identified", identifiers, candidates,
    note: "Manufacturer images remain separate from Vinted listing photos. Similar products are never definitive originals. Exact status means identifier agreement with a caller-observed label, not authentication." };
}
