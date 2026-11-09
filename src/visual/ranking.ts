import { fold } from "./common";
import type { Garment } from "./catalog";

export const FEATURES = ["color", "silhouette", "fit", "texture", "material", "details", "neckline", "length", "wash", "shoeModel"] as const;
export const WEIGHTS: Record<string, Record<string, number>> = {
  sweater: { color: 25, texture: 25, neckline: 20, silhouette: 15, fit: 5, material: 5, details: 5 },
  jeans: { fit: 25, silhouette: 20, length: 20, wash: 20, color: 10, details: 5 },
  boots: { silhouette: 25, length: 20, material: 20, color: 20, shoeModel: 10, details: 5 },
  default: { color: 25, silhouette: 20, fit: 15, material: 10, texture: 10, details: 10, length: 10 }
};
// Aliases are evidence for metadata matching only, never pixel observations.
export const ALIASES: Record<string, string[]> = {
  brown: ["brown", "bruin", "brun", "braun", "marron"], darkbrown: ["dark brown", "donkerbruin", "donker bruin", "donkerbruine", "donker bruine", "brun fonce", "marron fonce", "dunkelbraun"],
  beige: ["beige", "ecru", "cream", "creme"], lightbeige: ["light beige", "lichtbeige", "beige clair"],
  white: ["white", "wit", "blanc", "weiss"], black: ["black", "zwart", "noir", "schwarz"],
  blue: ["blue", "blauw", "bleu", "blau"], red: ["red", "rood", "rouge", "rot"],
  wheat: ["wheat", "tarwe", "camel", "ble"], gold: ["gold", "goud", "dore", "golden"],
  baggy: ["baggy", "wide leg", "wide-leg", "wijde pijpen", "ample"], relaxed: ["relaxed", "loose", "losvallend"],
  slim: ["slim", "slim fit", "skinny", "strak"], straight: ["straight", "rechte", "droit"],
  crewneck: ["crewneck", "crew neck", "ronde hals", "col rond", "rundhals"], vneck: ["v-neck", "v hals", "v-hals", "col v"],
  zip: ["zip", "rits", "zipper", "ritssluiting", "fermeture eclair"], hood: ["hoodie", "capuchon", "capuche"],
  waffle: ["waffle", "wafel", "gaufre"], cable: ["cable knit", "kabel", "torsade"], rib: ["ribbed", "rib", "geribbeld", "cotele"],
  knit: ["knit", "gebreid", "maille", "strick"], textured: ["textured", "structuur", "structure", "texture"],
  washed: ["washed", "wassing", "delave", "faded"], leather: ["leather", "leer", "cuir", "leder"],
  nubuck: ["nubuck", "nubuk"], cotton: ["cotton", "katoen", "coton", "baumwolle"], wool: ["wool", "wol", "laine", "wolle"],
  boots: ["boots", "boot", "laarzen", "bottines"], sneaker: ["sneaker", "sneakers", "trainer", "baskets"],
  logo: ["logo", "branding"], cropped: ["cropped", "crop", "kort model"], long: ["long", "lang", "lange", "longue"]
};
const GROUPS: Record<string, string[]> = { color: ["darkbrown", "brown", "lightbeige", "beige", "white", "black", "blue", "red", "wheat", "gold"],
  fit: ["baggy", "relaxed", "slim", "straight"], neckline: ["crewneck", "vneck", "zip", "hood"],
  texture: ["waffle", "cable", "rib", "knit", "textured"], material: ["leather", "nubuck", "cotton", "wool"], shoeModel: ["boots", "sneaker"] };
export function mentions(text: string, term: string): boolean {
  const escaped = fold(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(fold(text));
}
export function canonical(value: string): string {
  const s = fold(value);
  return Object.keys(ALIASES).find(k => k === s || ALIASES[k].includes(s)) || s;
}
export function variants(value: string): string[] { return ALIASES[canonical(value)] || [value]; }
function has(text: string, value: string): boolean { return variants(value).some(v => mentions(text, v)); }
export function metadataMatch(item: any, reference: any, garment: Garment): any {
  const weights = WEIGHTS[garment] || WEIGHTS.default;
  const description = String(item.description || "").split("\n").filter(line => !line.includes("#")).join(" ");
  const text = fold([item.title, description, item.color, ...(item.materials || []), item.categoryId === 1813 ? "crewneck" : ""].join(" "));
  let total = 0, matched = 0, known = 0;
  const criteria: any[] = [];
  for (const feature of FEATURES) {
    const wanted = reference[feature];
    if (!wanted) continue;
    const weight = weights[feature] || 5;
    total += weight;
    const featureText = feature === "color" && item.color ? fold(item.color) : feature === "material" && item.materials?.length ? fold(item.materials.join(" ")) : text;
    let status = has(featureText, wanted) ? "match" : "unknown";
    const parentShade = ({ darkbrown: "brown", lightbeige: "beige" })[canonical(wanted)];
    if (status === "unknown" && parentShade && has(featureText, parentShade)) status = "close";
    const other = (GROUPS[feature] || []).filter(v => canonical(wanted) !== v && has(featureText, v));
    // Broad color/texture terms provide partial information, not a confirmed exact shade/pattern.
    if (status === "unknown" && other.length && feature !== "texture") status = "mismatch";
    if (status === "match") matched += weight;
    if (status === "close") matched += weight * 0.5;
    if (status !== "unknown") known += weight;
    criteria.push({ feature, requested: wanted, status, weight, explanation: status === "match" ? "Alias occurs in listing metadata" : status === "close" ? "Broad color family agrees; precise shade is unverified" : status === "mismatch" ? `Conflicting metadata: ${other.join(", ")}` : "No supporting metadata" });
  }
  return { kind: "metadata", score: total ? Math.round(matched / total * 20) * 5 : null,
    coverage: total ? Math.round(known / total * 100) : 0, criteria, missing: criteria.filter(c => c.status === "unknown").map(c => c.feature),
    visualScore: null, explanation: "Approximate metadata relevance, not visual similarity or identification confidence." };
}

export function visualMatch(item: any, reference: any, garment: Garment, review?: any): any {
  if (!review) return { kind: "visual", score: null, missing: ["Actual image comparison"], status: "not_assessed" };
  if (!["chatgpt_vision", "user_image_review"].includes(review.observer) || !review.referenceImage || typeof review.referenceImage !== "string" ||
      !Array.isArray(review.candidateImageUrls) || !review.candidateImageUrls.length ||
      review.candidateImageUrls.some((url: string) => !item.photos.includes(url))) throw new Error("Visual review must cite a reference image and actual photos from this listing, with a supported observer");
  const weights = WEIGHTS[garment] || WEIGHTS.default;
  const comparisons = review.comparisons || [];
  if (!Array.isArray(comparisons) || comparisons.length > 10 || new Set(comparisons.map(c => c.feature)).size !== comparisons.length) throw new Error("Visual comparisons must use unique features (max 10)");
  const features = FEATURES.filter(f => reference[f]);
  if (!features.length) throw new Error("Provide reference features for a visual comparison");
  let total = 0, known = 0, points = 0;
  const criteria = features.map(feature => {
    const weight = weights[feature] || 5;
    total += weight;
    const c = comparisons.find(c => c.feature === feature);
    if (!c) return { feature, weight, status: "unknown", explanation: "No image observation supplied" };
    if (!["match", "close", "mismatch", "unknown"].includes(c.status) || typeof c.explanation !== "string" || !c.explanation.trim() || c.explanation.length > 500) throw new Error("Each visual observation needs a valid status and a short explanation");
    if (c.status !== "unknown") known += weight;
    points += weight * ({ match: 1, close: 0.5, mismatch: 0, unknown: 0 })[c.status];
    return { feature, weight, status: c.status, explanation: c.explanation };
  });
  const missing = criteria.filter(c => c.status === "unknown").map(c => c.feature);
  return { kind: "visual", score: known ? Math.round(points / total * 20) * 5 : null,
    coverage: Math.round(known / total * 100), criteria, missing, status: known ? "caller_image_assessment" : "not_assessed",
    evidence: { observer: review.observer, referenceImage: review.referenceImage, candidateImageUrls: review.candidateImageUrls },
    explanation: "Approximate weighted agreement from caller-supplied image observations. The server does not run a vision model or independently verify the observations. Missing features reduce the score." };
}
