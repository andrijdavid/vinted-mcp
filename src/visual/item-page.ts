import { parseItem } from "../vinted-core/parsers/response-parser";
import { getBaseUrl } from "../vinted-core/models/country";

/** Parse public structured data only. Never collect recommendation/gallery photos from other items. */
export function parseItemPage(html: string, id: number, country: string): any {
  const products: any[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(match[1]);
      products.push(...(Array.isArray(value) ? value : value["@graph"] || [value]).filter(p => p["@type"] === "Product"));
    } catch { /* another script may contain valid data */ }
  }
  const ld = products.find(p => !p.offers?.url || new RegExp(`/items/${id}(?:-|$)`).test(p.offers.url));
  if (!ld?.name) throw new Error("Item page contains no valid product data; unavailable or access restricted");
  const chunks: string[] = [];
  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { chunks.push(JSON.parse(match[1])); } catch { /* ignore non-data scripts */ }
  }
  const raw: any = { id, title: ld.name, description: ld.description, brand: ld.brand?.name, category: ld.category,
    price: { amount: ld.offers?.price, currency_code: ld.offers?.priceCurrency }, color: ld.color,
    url: ld.offers?.url || `${getBaseUrl(country)}/items/${id}`, photos: [], material: ld.material,
    sku: ld.sku, mpn: ld.mpn, gtin13: ld.gtin13 };
  let canBuy: boolean | undefined;
  let inspected = 0;
  function visit(value: any, owned = false): void {
    if (!value || typeof value !== "object" || ++inspected > 150_000) return;
    if (Array.isArray(value)) { for (const child of value) visit(child, owned); return; }
    if (value.item_id !== undefined) owned = String(value.item_id) === String(id);
    if (value.id !== undefined && value.seller_id !== undefined) owned = String(value.id) === String(id);
    if (owned) {
      if (value.seller_id) raw.user = { id: Number(value.seller_id) };
      if (value.catalog_id) raw.catalog_id = Number(value.catalog_id);
      if (typeof value.can_buy === "boolean") canBuy = value.can_buy;
      if (typeof value.favourite_count === "number") raw.favourite_count = value.favourite_count;
      if (Array.isArray(value.photos)) raw.photos.push(...value.photos);
      const data = value.data;
      if (data?.value) {
        if (value.code === "size") raw.size = data.value;
        if (value.code === "status") raw.condition = data.value;
        if (value.code === "color") raw.color = data.value;
        if (/material/.test(value.code)) raw.material = data.value;
        if (/brand/.test(value.code)) { raw.brand = data.value; raw.brand_id = Number(data.id) || null; }
      }
    }
    for (const child of Object.values(value)) visit(child, owned);
  }
  for (const line of chunks.join("").split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    try { visit(JSON.parse(line.slice(colon + 1))); } catch { /* RSC imports and text records are not JSON objects */ }
  }
  if (!raw.photos.length && ld.image) raw.photos = (Array.isArray(ld.image) ? ld.image : [ld.image]).map(p => typeof p === "string" ? p : p.url);
  const item: any = parseItem(raw, country);
  const availability = String(ld.offers?.availability || "").split("/").pop();
  item.isSold = availability === "OutOfStock" || availability === "SoldOut";
  item.availability = item.isSold ? "sold" : canBuy === true || availability === "InStock" ? "available" : "unknown";
  item.reserved = canBuy === false && !item.isSold;
  if (!item.condition) item.condition = ld.offers?.itemCondition?.split("/").pop()?.replace(/Condition$/, "") || null;
  return item;
}
