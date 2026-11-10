import { fold, textValue } from "./common";
import { manufacturerDomains, parseOriginalProducts, normalizeCode, normalizeBrand } from "./product";
import { ReferenceHttp, publicHttps } from "./reference-network";
import { extractIdentifiers } from "./identifiers";
import { productProfile } from "./product-profile";

export const SOURCE_TIERS = { A: "official_brand", B: "retailer", C: "archive_or_resale" } as const;
export const RETAILERS = ["zalando.nl", "zalando.de", "zalando.co.uk", "aboutyou.nl", "aboutyou.de", "debijenkorf.nl", "nordstrom.com", "asos.com", "mrporter.com", "endclothing.com", "breuninger.com", "jdsports.nl", "schuh.co.uk", "dtlr.com", "kith.com"];
export const ARCHIVES = ["vinted.nl", "vinted.fr", "vinted.de", "vestiairecollective.com", "grailed.com", "ebay.com", "ebay.nl"];
const OFFICIAL_BRANDS = ["Zara", "COS", "Arket", "Uniqlo", "H&M", "Mango", "Levi's", "Timberland", "G-Star", "Trussardi"];
export const domainMatches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
export function sourceInfo(value: string): { url: string; domain: string; tier: "A" | "B" | "C"; officialBrand: string | null } {
  const u = publicHttps(value), host = u.hostname.replace(/^www\./, "");
  const brand = OFFICIAL_BRANDS.find(b => manufacturerDomains(b).some(d => domainMatches(host, d)));
  const tier = brand ? "A" : RETAILERS.some(d => domainMatches(host, d)) ? "B" : ARCHIVES.some(d => domainMatches(host, d)) ? "C" : null;
  if (!tier) throw new Error("Unsupported product source domain; add a reviewed source adapter first");
  return { url: u.href, domain: host, tier, officialBrand: brand || null };
}

export interface ProductSourceAdapter {
  name: string;
  supports(url: string): boolean;
  parse(html: string, sourceUrl: string): any[];
}
/** Site adapters can add public, documented media formats; never read arbitrary scripts or
 * execute page content. Do not harvest recommendation carousels or unrelated OG images. */
export const jsonLdAdapter: ProductSourceAdapter = {
  name: "product_jsonld",
  supports: value => { try { sourceInfo(value); return true; } catch { return false; } },
  parse(html, url) {
    const products = parseOriginalProducts(html, url);
    return products.filter(p => {
      if (!p.productUrl) return products.length === 1;
      try { return publicHttps(new URL(p.productUrl, url).href).href === publicHttps(url).href; } catch { return false; }
    });
  }
};
export async function loadProductPage(url: string, http: ReferenceHttp, adapters = [jsonLdAdapter]): Promise<any[]> {
  const source = sourceInfo(url);
  const body = await http.get(source.url, "page");
  const adapter = adapters.find(a => a.supports(source.url));
  if (!adapter) return [];
  const html = new TextDecoder().decode(body.bytes);
  const products = adapter.parse(html, source.url);
  // Documented public API, same handle, and only AFTER the public page succeeds.
  // Never attempt this after a login wall or 403. No recommendation galleries.
  const handle = new URL(source.url).pathname.match(/^(.*\/products\/)([^/.]+)\/?$/);
  if (handle && /Shopify[.\s]|name=["']generator["'][^>]*Shopify/i.test(html)) {
    try {
      const apiUrl = new URL(`${handle[1]}${handle[2]}.js`, source.url).href;
      const json = await http.get(apiUrl, "product_json");
      const extra = parseShopifyProduct(JSON.parse(new TextDecoder().decode(json.bytes)), source.url);
      if (extra && !products.length) products.push(extra);
      else if (extra) for (const p of products) {
        if (fold(p.brand) === fold(extra.brand) && (!p.color || !extra.color || fold(p.color) === fold(extra.color)) &&
            p.identifiers.some(i => extra.identifiers.some(j => normalizeCode(i.value) === normalizeCode(j.value)))) {
          p.photos = extra.photos; p.color ||= extra.color; p.mediaEvidenceMethod = "same_handle_shopify_product_api";
        }
      }
    } catch (error) {
      if (!products.length) throw error;
      products.forEach(p => { p.mediaWarning = `Public product gallery unavailable: ${String(error)}`; });
    }
  }
  if (source.officialBrand && products.some(p => normalizeBrand(p.brand) !== normalizeBrand(source.officialBrand))) throw new Error("Product brand contradicts or is absent on official domain");
  return products.map(p => ({ ...p, source,
    sourceListedPrice: p.sourceListedPrice ? { ...p.sourceListedPrice, kind: source.tier === "A" ? "manufacturer_offer_price_at_fetch_time" : "source_offer_price_at_fetch_time" } : null,
    retrievedAt: body.retrievedAt, sourceAdapter: adapter.name,
    identifiers: p.identifiers.map(i => ({ ...i, fieldSource: i.source, source: `${p.mediaEvidenceMethod || "source_jsonld"}:${i.type}` })) }));
}

export function parseShopifyProduct(p: any, sourceUrl: string): any | null {
  const handle = new URL(sourceUrl).pathname.match(/\/products\/([^/.]+)\/?$/)?.[1];
  if (!handle || p.handle !== handle || typeof p.title !== "string" || typeof p.vendor !== "string" || !Array.isArray(p.variants) || !Array.isArray(p.media)) return null;
  const colorOption = (p.options || []).find(o => /^(colou?r|kleur|couleur)$/i.test(o.name));
  // Multi-color galleries are ambiguous; never mix their photos across variants.
  if (colorOption?.values?.length > 1) return null;
  const identifiers = p.variants.slice(0, 100).flatMap(v => extractIdentifiers({ sku: v.sku, gtin: v.barcode }));
  const photos = p.media.slice(0, 30).filter(m => m.media_type === "image" && m.src).map(m => {
    try { return { url: publicHttps(new URL(m.src, sourceUrl).href).href, caption: textValue(m.alt), sourceUrl,
      role: "possible_original_product_not_listing_photo" }; } catch { return null; }
  }).filter(Boolean).slice(0, 10);
  return { name: p.title, brand: p.vendor, model: null, modelCode: identifiers.find(i => i.type === "sku")?.value || null,
    identifiers, color: colorOption?.values?.[0] || null, material: null, category: p.type || null,
    originalPrice: null, sourceListedPrice: null, specifications: [], photos, sourceUrl,
    evidenceMethod: "server_fetched_product_api", mediaEvidenceMethod: "same_handle_shopify_product_api" };
}

export interface SearchPlanEntry { query: string; purpose: "identity" | "similar"; tier: "A" | "B" | "C" | "D"; }
export function referenceQueries(item: any, identifiers = extractIdentifiers(item)): SearchPlanEntry[] {
  const profile = productProfile(item);
  const brand = String(item.brand || "").slice(0, 100), title = String(item.title || "").slice(0, 180);
  const model = profile.model, color = textValue(item.color) || "";
  const queries: SearchPlanEntry[] = [];
  const add = (query: string, purpose: "identity" | "similar", tier: "A" | "B" | "C" | "D") => {
    query = query.replace(/[\r\n]/g, " ").trim().slice(0, 550);
    if (query && !queries.some(p => p.query === query)) queries.push({ query, purpose, tier });
  };
  for (const code of identifiers.slice(0, 2)) {
    for (const domain of manufacturerDomains(brand).slice(0, 1)) add(`site:${domain} "${brand}" "${code.value}"`, "identity", "A");
    add(`"${brand}" "${code.value}"`, "identity", "B");
  }
  if (model) add(`"${brand}" "${model}" ${color}`, "identity", "A");
  add(`${brand} ${title} ${color} worn by model`, "identity", "A");
  add(`${brand} ${item.collection || ""} ${title} product retailer`, "identity", "B");
  if (profile.collection || profile.material || profile.construction) add(`${brand} ${profile.collection || ""} ${profile.material || ""} ${profile.construction || ""} ${title}`, "identity", "B");
  add(`${brand} ${title} archive vintage`, "identity", "C");
  const text = fold(`${title} ${item.description || ""}`);
  const garment = /jeans|denim/.test(text) ? "jeans wide leg baggy washed" : /boot|laarz/.test(text) ? "boots on feet" : /trui|sweater|knit|pull|rib/.test(text) ? "knitwear crewneck sweater" : /t-shirt|tshirt|t shirt/.test(text) ? "T-shirt" : title;
  const texture = /rib|cotele/.test(text) ? "ribbed" : /cable|kabel/.test(text) ? "cable knit" : "";
  const fit = /oversized|baggy|loose|relaxed/.exec(text)?.[0] || "";
  add(`${color} ${texture} ${garment} ${fit} on model COS Arket Uniqlo`, "similar", "D");
  add(`${color} ${texture} ${garment} ${fit} gedragen model pasvorm`, "similar", "D");
  add(`${color} ${texture} ${garment} ${fit} porte mannequin coupe`, "similar", "D");
  return queries;
}

export interface SearchProvider {
  name: string;
  available: boolean;
  search(plan: SearchPlanEntry): Promise<string[]>;
}
export class CallerSearchProvider implements SearchProvider {
  name = "chatgpt_web_handoff"; available = false;
  async search(): Promise<string[]> { return []; }
}
/** Opt-in only. An installed connector's ChatGPT web tool cannot be called by this server.
 * Brave endpoint/header verified against official API docs, not HTML search scraping. */
export class BraveSearchProvider implements SearchProvider {
  name = "brave_web_search"; available: boolean;
  constructor(private key: string | undefined, private http: ReferenceHttp) { this.available = !!key; }
  async search(plan: SearchPlanEntry): Promise<string[]> {
    if (!this.key) return [];
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", plan.query); url.searchParams.set("count", "5");
    const body = await this.http.get(url.href, "search", { "X-Subscription-Token": this.key });
    const parsed = JSON.parse(new TextDecoder().decode(body.bytes));
    return (parsed.web?.results || []).slice(0, 5).map(r => r.url).filter(v => typeof v === "string");
  }
}
