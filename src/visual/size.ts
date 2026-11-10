import { fold } from "./common";

const CONDITION = /^(?:tres bon etat|bon etat|satisfaisant|neuf|nieuw|heel goed|goed|redelijk|very good|good|satisfactory|new with|new without|sehr gut|gut|ottim|buono|nuevo|muy bueno)/;
export function isCondition(value: string): boolean { return CONDITION.test(fold(value)); }
export function normalizeSize(value: unknown): string | null {
  if (typeof value !== "string" || isCondition(value)) return null;
  const s = value.trim().toUpperCase();
  const waist = s.match(/\bW\s*(\d{2})(?:\s*(?:\/|X)?\s*L\s*\d{2})?\b/);
  if (waist) return `W${waist[1]}`;
  const alpha = s.match(/^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL)(?=\s|[\/|]|$)/);
  if (alpha) return ({ "2XL": "XXL", "3XL": "XXXL" })[alpha[1]] || alpha[1];
  const eu = s.match(/^(?:EU\s*)?(\d{2}(?:[.,]5)?)(?:\s*(?:EU|[|/].*))?$/);
  if (eu) return `EU${eu[1].replace(",", ".")}`;
  if (/^(?:ONE SIZE|TU|UNIQUE|ONE-SIZE)$/.test(s)) return "ONE SIZE";
  return null;
}
export function sizeSystem(value: unknown): string | null {
  const size = normalizeSize(value);
  return size?.startsWith("W") ? "waist_inches" : size?.startsWith("EU") ? "EU" : size ? "international" : null;
}
export function sizeMatch(requested: unknown, actual: unknown): "exact" | "mismatch" | "unknown" {
  const want = normalizeSize(requested), got = normalizeSize(actual);
  if (!want || !got) return "unknown";
  return want === got ? "exact" : "mismatch";
}

/** Only explicitly labelled sizes count as title evidence; never infer from arbitrary numbers. */
export function titleSize(value: string): string | null {
  const text = fold(value);
  const waist = text.match(/\bw\s*\d{2}\b/);
  if (waist) return normalizeSize(waist[0]);
  const match = text.match(/\b(?:maat|size|taille|taglia|gro(?:ss|ß)e|eu|t\.)\s*[:.]?\s*(xxxl|xxl|xl|xs|[sml]|\d{2})\b/);
  if (match) return normalizeSize(match[1]);
  return null;
}
