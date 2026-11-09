import snapshot from "./catalog-snapshot.json";
import { fold } from "./common";

export const GARMENTS = ["sweater", "tshirt", "shirt", "jacket", "jeans", "trousers", "shoes", "boots", "accessory"] as const;
export type Garment = typeof GARMENTS[number];
export const MEN_CATALOG: Record<Garment, number> = { sweater: 79, tshirt: 77, shirt: 536, jacket: 1206, jeans: 257, trousers: 34, shoes: 1231, boots: 1233, accessory: 82 };
export const CATEGORY_SOURCE = { url: snapshot.source, retrievedAt: snapshot.retrievedAt, warning: "Public Vinted taxonomy snapshot; IDs may change." };
export function isDescendant(id: number, ancestor: number): boolean {
  const seen = new Set<number>();
  while (id && !seen.has(id)) {
    if (id === ancestor) return true;
    seen.add(id);
    id = snapshot.parents[String(id)];
  }
  return false;
}
export function audience(item: any): "men" | "women" | "kids" | "unknown" {
  if (isDescendant(item.categoryId, 5)) return "men";
  if (isDescendant(item.categoryId, 1904)) return "women";
  if (isDescendant(item.categoryId, 1193)) return "kids";
  const t = fold([item.title, item.category, item.description].join(" "));
  if (/\b(women|woman|femme|dames|damen|donna|mujer|ladies)\b/.test(t)) return "women";
  if (/\b(kids|child|children|enfant|baby|kinderen|junior|jongens|meisjes)\b/.test(t)) return "kids";
  if (/\b(men|mens|homme|heren|herren|uomo|hombre)\b/.test(t)) return "men";
  return "unknown";
}
export function categoryMatches(item: any, garment: Garment): boolean | null {
  if (!item.categoryId || !snapshot.parents[String(item.categoryId)]) return null;
  return isDescendant(item.categoryId, MEN_CATALOG[garment]);
}
export const garmentTerms: Record<Garment, string[]> = {
  sweater: ["trui", "knit sweater", "pull maille"], tshirt: ["t-shirt", "tee", "t shirt"],
  shirt: ["overhemd", "shirt", "chemise"], jacket: ["jas", "jacket", "veste"],
  jeans: ["jeans", "spijkerbroek", "jean"], trousers: ["pantalon", "trousers", "broek"],
  shoes: ["schoenen", "shoes", "chaussures"], boots: ["boots", "laarzen", "bottines"],
  accessory: ["ketting", "chain necklace", "collier"]
};
