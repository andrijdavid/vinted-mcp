import type { VintedAPIClient } from "../vinted-core";
import { resolveItem } from "./get-item-images";
import { ListingImageLoader } from "../visual/images";
import { referenceService, ReferenceService, IMAGE_TYPES, COMPARISON_FEATURES } from "../visual/references";

const urlSchema = { type: "string", maxLength: 2000 };
export const referenceEvidenceProperties = {
  sourceUrls: { type: "array", maxItems: 6, items: urlSchema, description: "Actual public product pages on supported official, retailer or archive domains; never invented URLs" },
  labelEvidence: { type: "object", additionalProperties: false, properties: { photoUrl: urlSchema, observedCode: { type: "string", maxLength: 100 } }, required: ["photoUrl", "observedCode"] },
  webEvidence: { type: "array", maxItems: 6, items: { type: "object", additionalProperties: false, properties: {
    sourceUrl: urlSchema, name: { type: "string", maxLength: 300 }, brand: { type: "string", maxLength: 100 },
    modelCode: { type: "string", maxLength: 100 }, model: { type: "string", maxLength: 100 }, color: { type: "string", maxLength: 100 }, material: { type: "string", maxLength: 300 },
    observation: { type: "string", minLength: 1, maxLength: 1000, description: "Facts actually seen on the source page, not instructions. Browser-only facts cannot establish exact identity." },
    photoUrls: { type: "array", maxItems: 6, items: urlSchema },
    images: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, properties: {
      imageUrl: urlSchema, imageType: { type: "string", enum: IMAGE_TYPES }, onModel: { type: ["boolean", "null"] },
      color: { type: "string", maxLength: 100 }, productCode: { type: "string", maxLength: 100 }, model: { type: "string", maxLength: 100 },
      observer: { type: "string", enum: ["chatgpt_vision", "user_image_review"] }, observation: { type: "string", minLength: 1, maxLength: 1000 }
    }, required: ["imageUrl", "imageType", "onModel", "observer", "observation"] } },
    comparison: { type: "object", additionalProperties: false, properties: {
      listingPhotoUrl: urlSchema, referenceImageUrl: urlSchema, observer: { type: "string", enum: ["chatgpt_vision", "user_image_review"] },
      features: { type: "array", maxItems: 13, items: { type: "object", additionalProperties: false, properties: {
        feature: { type: "string", enum: COMPARISON_FEATURES }, status: { type: "string", enum: ["match", "close", "mismatch", "unknown"] },
        explanation: { type: "string", minLength: 1, maxLength: 500 }
      }, required: ["feature", "status", "explanation"] } }
    }, required: ["listingPhotoUrl", "referenceImageUrl", "observer", "features"] }
  }, required: ["sourceUrl", "name", "brand", "observation"] } }
};
export const referenceOptionsProperties = {
  preferOnModel: { type: "boolean", default: true }, maxImages: { type: "integer", minimum: 1, maximum: 8, default: 5 },
  allowSimilar: { type: "boolean", default: true }, ...referenceEvidenceProperties
};
export const referenceRequestSchema = { type: "object", additionalProperties: false, properties: referenceOptionsProperties };
export const lazyReferenceDefinitions = { productReferenceRequest: { type: "object", additionalProperties: false,
  properties: { itemId: { type: "integer", minimum: 1 }, ...referenceOptionsProperties }, required: ["itemId"] } };
export const lazyReferenceProperties = {
  includeReferenceImages: { type: "boolean", default: false, description: "Opt in AFTER inspecting actual listing photos. Enrich at most referenceLimit selected candidates, never every search result." },
  referenceLimit: { type: "integer", minimum: 1, maximum: 3, default: 1 },
  referenceRequests: { type: "array", maxItems: 3, items: { $ref: "#/$defs/productReferenceRequest" }, description: "Selected listing IDs and their source/label observations; ignored if not selected/returned" }
};
export const findProductReferenceImagesTool = {
  name: "find_product_reference_images",
  description: "Find source-checked official product, retailer or on-model fit reference images for one Vinted listing. Exact requires an observed listing label code, matching brand/color and fetched reliable product facts. Similar references are DIFFERENT products and require observations of both real images. No mandatory search API: returns multi-strategy queries for ChatGPT browsing when unavailable. includeContent (default true) returns actual Vinted and reference images separately; preserve each contentIndex and matchType. No image URL or caption alone proves visual likeness, current condition or authenticity.",
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  inputSchema: { type: "object", additionalProperties: false, properties: {
    itemId: { type: "integer", minimum: 1 }, url: urlSchema, country: { type: "string", default: "fr" },
    ...referenceOptionsProperties, includeContent: { type: "boolean", default: true }
  }, anyOf: [{ required: ["itemId"] }, { required: ["url"] }] },
  outputSchema: { type: "object", properties: {
    itemId: { type: "integer" }, listingUrl: { type: "string" }, identificationStatus: { type: "string", enum: ["exact_verified", "probable_same_product", "similar_reference", "not_found"] },
    referenceImages: { type: "array", items: { type: "object", properties: { imageUrl: { type: "string" }, sourcePageUrl: { type: "string" }, sourceDomain: { type: "string" },
      imageType: { type: "string", enum: IMAGE_TYPES }, matchType: { type: "string", enum: ["exact_verified", "probable_same_product", "similar_reference"] },
      onModel: { type: ["boolean", "null"] }, verificationEvidence: { type: "object" }, retrievedAt: { type: "string" }
    }, required: ["imageUrl", "sourcePageUrl", "sourceDomain", "imageType", "matchType", "onModel", "verificationEvidence", "retrievedAt"] } }
  }, required: ["itemId", "listingUrl", "identificationStatus", "referenceImages"] }
};
export async function handleFindProductReferenceImages(client: VintedAPIClient, args: any, service: ReferenceService = referenceService, listingLoader = new ListingImageLoader()): Promise<any> {
  const { id, country } = resolveItem(args);
  const item = await client.getItem(id, country, args.url);
  const data = await service.find(item, { ...args, country });
  const blocks: any[] = []; let bytes = 0;
  if (args.includeContent !== false) {
    const entries = [data.vintedImages[0], ...data.referenceImages].filter(Boolean);
    for (const entry of entries) {
      try {
        const listing = entry.role === "actual_offered_item_condition_evidence";
        const payload = listing ? await listingLoader.load(entry.imageUrl) : await service.loadImage(entry.imageUrl);
        if (bytes + payload.bytes > 900_000) { data.warnings.push("Aggregate inline image limit reached; remaining validated links retain provenance"); break; }
        bytes += payload.bytes;
        Object.assign(entry, { contentIncluded: true, contentIndex: blocks.length + 1, mimeType: payload.mimeType, width: payload.width, height: payload.height });
        blocks.push({ type: "image", mimeType: payload.mimeType, data: payload.data });
      } catch (error) { data.errors.push({ imageUrl: entry.imageUrl, stage: "inline_image", error: String(error) }); }
    }
  }
  data.visualAccess = blocks.length ? "image_bytes_returned_host_visibility_unverified" : "validated_external_links_host_visibility_unverified";
  return { structuredContent: data, content: [{ type: "text", text: JSON.stringify(data) }, ...blocks] };
}

export async function enrichSelectedReferences(client: VintedAPIClient, candidates: any[], args: any, service = referenceService): Promise<void> {
  if (!args.includeReferenceImages) return;
  const limit = args.referenceLimit ?? 1;
  if (!Number.isInteger(limit) || limit < 1 || limit > 3) throw new Error("referenceLimit must be 1..3");
  const requests = args.referenceRequests || [];
  const selected = requests.length ? candidates.filter(c => requests.some(r => r.itemId === c.id)).slice(0, limit) : candidates.slice(0, limit);
  for (const candidate of selected) {
    try {
      const item = await client.getItem(candidate.id, args.country || candidate.country || "fr");
      const options = requests.find(r => r.itemId === candidate.id) || {};
      const result = await service.find(item, { ...options, includeContent: false });
      candidate.referenceImages = result.referenceImages;
      candidate.productReference = result;
    } catch (error) { candidate.referenceImages = []; candidate.productReference = { identificationStatus: "not_found", error: String(error) }; }
  }
}
