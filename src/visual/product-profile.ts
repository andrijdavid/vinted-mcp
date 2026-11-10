import { textValue } from "./common";
import { extractIdentifiers } from "./identifiers";

/** Explicit seller metadata, not image-derived facts or proof. Do not promote title
 * keywords to a model name. Label codes observed by ChatGPT are supplied separately. */
export function productProfile(item: any): any {
  const description = String(item.description || "").slice(0, 4000);
  const field = (pattern: RegExp) => description.match(pattern)?.[1]?.trim().slice(0, 100) || null;
  const model = textValue(item.model || item.modelName) || field(/(?:^|\n)\s*(?:model name|modelnaam|model|modele)\s*:\s*([^\n]{3,100})/i);
  const collection = textValue(item.collection || item.productLine) || field(/(?:^|\n)\s*(?:collection|collectie|product line|productlijn)\s*:\s*([^\n]{3,100})/i);
  const material = item.materials?.length ? item.materials.join(", ").slice(0, 300) : field(/(?:^|\n)\s*(?:material|materiaal|composition|samenstelling)\s*:\s*([^\n]{3,100})/i);
  const construction = field(/(?:^|\n)\s*(?:construction|constructie|details)\s*:\s*([^\n]{3,100})/i);
  return { brand: item.brand || null, title: item.title || null, model, color: item.color || null, collection, material, construction,
    identifiers: item.productIdentifiers || extractIdentifiers(item), evidenceMethod: "explicit_listing_metadata_unverified",
    visualEvidenceRequired: ["Actual label codes", "Visible knit/wash/sole details", "Actual cut, measurements and condition"] };
}
