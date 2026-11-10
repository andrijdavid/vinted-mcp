import { textValue } from "./common";

export function extractIdentifiers(raw: any): { type: string; value: string; source: string }[] {
  const identifiers: { type: string; value: string; source: string }[] = [];
  for (const [field, type] of [["sku", "sku"], ["product_code", "product_code"], ["model_number", "model"], ["ean", "ean"], ["gtin", "ean"], ["gtin13", "ean"], ["gtin8", "gtin"], ["gtin12", "gtin"], ["gtin14", "gtin"], ["mpn", "model"]]) {
    const value = textValue(raw[field]);
    if (value && (!/ean|gtin/.test(type) || validGTIN(value))) identifiers.push({ type, value, source: `listing.${field}` });
  }
  const text = `${raw.title || ""}\n${raw.description || ""}`;
  for (const m of text.matchAll(/\b(EAN|GTIN|SKU|MPN|model(?:nummer|number)?|art(?:ikel|icle)?[. ]?(?:nummer|number|no|nr)?|product\s*code|ref(?:erence)?)\s*[:#.]?\s*([A-Z0-9][A-Z0-9/-]{4,24})\b/gi)) {
    if (!/\d/.test(m[2])) continue;
    const type = /ean|gtin/i.test(m[1]) ? "ean" : "product_code";
    if (type === "ean" && !validGTIN(m[2])) continue;
    identifiers.push({ type, value: m[2], source: "listing.text (seller claim, unverified)" });
  }
  return [...new Map(identifiers.map(x => [`${x.type}:${x.value.toUpperCase()}`, x])).values()];
}
export function validEAN(value: string): boolean {
  return /^\d{13}$/.test(value) && validGTIN(value);
}
export function validGTIN(value: string): boolean {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) return false;
  const sum = value.slice(0, -1).split("").reverse().reduce((s, c, i) => s + Number(c) * (i % 2 ? 1 : 3), 0);
  return (10 - sum % 10) % 10 === Number(value.at(-1));
}
