# Original product and on-model references

This extension adds `find_product_reference_images` to the existing eleven MCP tools. ChatGPT handles presentation; the server provides evidence, source relationships and separate image blocks. No extra UI, mandatory AI/search API, GPU or browser is introduced. The offered item's condition always comes from its Vinted photos.

## Contract

```json
{
  "url": "https://www.vinted.nl/items/10747214544-timberland-boots",
  "preferOnModel": true,
  "maxImages": 5,
  "allowSimilar": true,
  "includeContent": true
}
```

Inputs: positive `itemId` or Vinted `url`; optional `country` (default `fr`, inferred from URL), `preferOnModel` (true), `maxImages` (5, range 1–8), `allowSimilar` (true), `includeContent` (true), `sourceUrls` (up to six actual public product URLs), `webEvidence` (up to six observations) and `labelEvidence` (`photoUrl`, `observedCode`). Country conflicts with a listing URL are rejected. All MCP input schemas are validated before dispatch.

`labelEvidence.photoUrl` must belong to that listing. The code must be plausible and must itself match the product source to contribute exact evidence. A second, unrelated label code cannot promote a seller-text match. The server validates provenance, but relies on the caller's truthful report of what is visible on the label.

The tool returns `structuredContent` plus the same JSON in its first text block. Its output schema defines required image/provenance fields and the status enum. Key fields:

- `itemId`, `listingUrl`, `country`, `listing` (price, size, condition and seller), `listingProductProfile` (explicit metadata, never vision inference).
- `vintedImages`: actual listing image links with role `actual_offered_item_condition_evidence`.
- `identifiedProduct`: only populated for exact/probable identity; `referenceProduct`: separate different-product reference. Top-level `brand` remains the listing brand; alternative model/code never replace the offered item's identity.
- `identificationStatus`, Dutch `label`, `originalProductPageUrl` (only official exact/probable source), `productPageUrl` (including retailer/alternative), `referenceImages`, `availableViews`.
- `matchingSources`, `missingIdentificationData`, `warnings`, `errors`, `search` (capabilities, attempted queries, handoff plan), `retrievedAt`.

Each reference image has `imageUrl`, `sourcePageUrl`, `sourceDomain`, `sourceTier`, `imageType`, `matchType`, `onModel` (boolean or null), `verificationEvidence`, `retrievedAt`, `product` and optional `fitComparison`. `alsoFoundAt` preserves other verified sources when decoded content is duplicated. `retrievedAt` is the actual image fetch time, including cache hits; page fetch times are separate. Caller-only page facts have no invented server page timestamp.

Inline delivery first returns one actual Vinted image, then reference images within 900 KB combined JPEG data. `contentIndex` points into the content array; the first text block is index 0. Each photo is at most 1000×1000 pixels and 300 KB. Validated links remain available when the inline limit is reached. Use `includeContent:false` for links/structured data only; reference downloads are still validated before their links are returned. Bytes returned by MCP do not themselves prove the host exposed them to ChatGPT vision.

## Strict identification and labels

| Status | Meaning | Dutch presentation |
| --- | --- | --- |
| `exact_verified` | Same observed label code, brand and color; no model conflict; independently fetched official/retailer product data | Originele webshopfoto — exact product bevestigd |
| `probable_same_product` | Brand plus matching identifier, or explicit model + color + material agreement; missing decisive label/variant/source proof | Waarschijnlijk hetzelfde product — niet volledig bevestigd |
| `similar_reference` | Different/unconfirmed product used only after actual-image fit comparison | Vergelijkbare pasvormreferentie — ander product |
| `not_found` | No usable validated original or allowed fit reference | Oorspronkelijke productfoto niet gevonden |

Browser-only observations and archive/resale sources cannot establish exact identity. Unknown color cannot become exact; explicit conflicting color/model cannot become probable. Broad shade labels are conservative: brown and dark brown are not an exact variant match. Matching codes never prove authenticity, ownership or current condition. Each image keeps its own status even when a response contains several products/sources. No product images means `not_found` even if some identity metadata was found.

`find_original_product` preserves `status`, `identifiers`, `candidates`, prices/photos, errors, query strings and timestamps. Legacy statuses (`exact_product_confirmed`, `probable_same_model`, `similar_product_only`, `not_identified`) remain; `identificationStatus` is additive. Its photo links are metadata, not download-validated reference images; use the new tool for validated media. Stronger checks can downgrade previously overconfident legacy results. Source limits expand from three to six and official/retailer/archive domains are supported. `includeReferenceImages:true` adds the new result lazily.

## Identification before selection

The shared profile uses brand, title, explicit model, collection/product line, color, material, construction and codes from fields and labelled description lines. Code extraction supports SKU/MPN/article/reference fields and checksum-validated GTIN-8/12/13/14. Codes observed on actual label images are separate caller evidence. It does not invent a model from generic title words, infer unseen labels or run OCR/vision.

Search plans combine brand+code, official-domain+code, explicit model+color, product name, collection/material/construction, retailer and archive queries. Alternative plans use garment, texture, fit/color and English/Dutch/French on-model terms. The server does not treat seller text as instructions.

## Providers and source adapters

`SearchProvider` separates search discovery from product/media verification. Default `CallerSearchProvider` reports `automatedSearchAvailable:false` and returns multiple targeted queries. The MCP process cannot call ChatGPT's web tool itself. ChatGPT searches using its own available capability, then supplies real `sourceUrls` and observations. No API key is needed for this workflow.

`BraveSearchProvider` is explicitly opt-in: `VINTED_REFERENCE_SEARCH=brave` with `BRAVE_SEARCH_API_KEY`. Without a key it remains unavailable. It uses the [documented Brave Web Search endpoint and authentication header](https://api-dashboard.search.brave.com/api-reference/web/search/get), not scraped search-result HTML. It performs at most four search calls: multiple identity strategies plus separate fit-reference searches when allowed. Results are actual returned URLs; unsupported domains are discarded. This may incur provider charges and was tested with fixtures, not live credentials. Another provider can implement the same interface without changing identity rules.

Sources are inspected in A/B/C order. D is a **relationship to the Vinted item**, not an authority tier: a similar reference can itself come from an official COS source while remaining a different product.

- A: reviewed official domains for Zara, COS, Arket, Uniqlo, H&M, Mango, Levi's, G-Star, Timberland and Trussardi. Timberland includes the reviewed NZ/Australia regional shops.
- B: reviewed retailers in `reference-sources.ts`, including Zalando, About You, de Bijenkorf, Nordstrom, ASOS, Mr Porter, END., Breuninger, JD Sports, Schuh, DTLR and Kith.
- C: reviewed public archive/resale domains including Vinted NL/FR/DE, Vestiaire Collective, Grailed and eBay.

The domain policy is a bounded source registry, not a guarantee that every page on a domain is trustworthy. Unknown domains require a reviewed registry/adapter change, even for browser fallback. Exact claims still need the label, product and variant evidence. Domain suffix lookalikes are rejected.

`ProductSourceAdapter` currently provides Product JSON-LD parsing: explicit Product.image media and ImageObject captions, including inherited ProductGroup brand/source with individual variant identifiers. Unrelated product URLs, ambiguous unbound multi-product pages and recommendation lists are excluded. Raw HTML, scripts and OG/Google image results are never executed or indiscriminately harvested.

A Shopify gallery extension uses the [documented public Product Ajax API](https://shopify.dev/docs/api/ajax/reference/product) for the **same product handle**, only after the normal page loads successfully and identifies Shopify. JSON is parsed without execution, including Shopify's `text/javascript` JSON MIME. Handle, vendor, code and color consistency bind gallery media; multi-color API galleries are rejected. Missing API access preserves other verified images. A blocked page never triggers this alternate endpoint. No authenticated/admin API is used.

Some sites omit product data, captions or gallery associations. Add a site adapter for its public documented data, or use explicitly caller-supplied web evidence. An adapter must preserve product/variant association and the shared network policy.

## On-model images and different-product references

Priority is identity confidence, on-model usability (when preferred), source tier and front/side/back/detail/product views. Image types are `model_front`, `model_side`, `model_back`, `model_unspecified`, `detail`, `product_only`, `unknown`. `onModel:null` means unknown. A filename never establishes a view or the presence of a model. Explicit source captions can suggest on-model presence, labelled `source_image_caption_unverified_visually`; ChatGPT/user image observations are labelled `caller_image_observation`. Captions and caller observations do not become independently verified computer vision.

`webEvidence.images[]` supplies `imageUrl`, `imageType`, `onModel`, `observer` (`chatgpt_vision` or `user_image_review`) and a concrete `observation`; optional image `color`, `productCode` and `model` can flag variants. For a fetched product, observations can annotate only images already bound to that product. Wrong observed variants and declared synthetic images are excluded. The server cannot detect every unlabelled synthetic or wrongly tagged official photo; this remains an observer/source limitation.

For a different-product reference, provide `webEvidence.comparison`:

```json
{
  "listingPhotoUrl": "<actual photo URL from this Vinted listing>",
  "referenceImageUrl": "<actual product-page image URL inspected>",
  "observer": "chatgpt_vision",
  "features": [
    {"feature":"category","status":"match","explanation":"Concrete observation of both photos"},
    {"feature":"color","status":"close","explanation":"Concrete color similarities and shade difference"}
  ]
}
```

This abbreviated example is not a sufficient sweater comparison. The full review needs unique feature observations (`match`, `close`, `mismatch`, `unknown`), actual listing/reference URLs and a supported observer. All alternatives require category, color, fit and silhouette agreement. Sweaters also require length, texture and neckline; jeans require length/wash; boots require toe, sole and material **appearance**; other garments require length/details. Additional unknowns/differences remain explicit. A boot shaft hidden under trousers must be reported unknown; reference images can still demonstrate how the trousers fall over the visible boot. Fit review never establishes shoe comfort or measurements. Metadata shade differences can remain in a similar reference only when actual-image observations explain usable visual agreement; they cannot establish exact identity.

The reference must be observed on a model. A metadata-only same-brand result, unreviewed model photo, wrong-neckline sweater or conflicting essential feature is not accepted as a fit reference. Without enough observations, the tool returns handoff queries and `not_found`; it does not fabricate a comparison. Unknown or mismatching optional features appear in `fitComparison.uncertainties`/`differences`. `allowSimilar:false` suppresses all different-product references and their search queries.

## Lazy workflow and presentation

1. Search Vinted; filter size, category, price and metadata.
2. Inspect actual listing images via `get_item_images`; it also returns reference-tool arguments.
3. Assess the reference outfit against the listing with `assess_visual_match`; original photos never replace actual-condition evidence.
4. Call `find_product_reference_images` only for shortlisted items. Search/browse again with returned strategies when appropriate; supply honest observations rather than fabricated facts.
5. Present item/price/size/condition/seller, image A (Vinted), image B (labelled product/fit reference), identification, color/fit/material/silhouette/details/differences and clickable page sources.

`search_similar_items`, `find_similar_outfit`, `assess_visual_match` accept `includeReferenceImages` (false), `referenceLimit` (1, maximum 3) and up to three `referenceRequests` (`itemId` plus the new reference options/evidence). Search enriches requested returned candidates or its first candidates. Outfit enriches only selected items from the top eligible combination, after optional real-photo reviews; the limit is global per call. Results gain optional `referenceImages`/`productReference`. No enrichment runs by default. Wrong/not-returned request IDs are never fetched. For full image content call the dedicated tool. There is no hundreds-of-results gallery prefetch.

## Network, resource and evidence limits

External sources use HTTPS only, no credentials/custom ports or literal IPs; reviewed product domains; all IPv4 DNS answers must be public. Socket lookup is pinned to the validated address while TLS verifies the original host, preventing DNS rebinding. IPv6-only sources fail closed. Requests do not inherit browser sessions, proxies or Vinted credentials. Redirects are refused, including to another public URL; provide a separately verified final public product URL instead.

One deadline covers DNS, headers and streaming body (10 seconds). Page/JSON bodies are at most 2 MB; images at most 4 MB and 20 million decoded pixels. MIME and decoded JPEG/PNG/WebP format must agree; animation is rejected. At most two external HTTP requests run concurrently with 350 ms start spacing; 403/429/503 open a 60-second origin cooldown without retry/bypass. Calls inspect at most six product pages (plus at most one same-handle API each), ten image downloads and a 45-second lookup admission budget; an in-flight request can finish after that budget, within its own deadline. Results can be partial.

HTTP body cache: 15-minute TTL, 48 entries; resized image cache: 10-minute TTL, 24 entries. Pending requests coalesce; URL and decoded-content duplicates are removed. Failed loads are not cached as successful evidence. Existing Vinted image limits/rate controls stay in place. Native sharp workers/memory are bounded by the existing loader setup. No images are permanently copied by the tool; inline data and cache are transient. Page/image links retain copyright and source attribution. Do not use the tool to bypass access restrictions or disregard source terms.

## Verification and safe activation

Use `npm run verify:isolated` in the active checkout. Standard `npm run build`, `bundle` and `test` run inside the temporary copy, with source-checkout `dist/bundle.js`, `start-stdio.sh` and `mcp.local.json` hashes checked before/after. The new live script requires explicit opt-in and runs against the **current directory's bundle**:

```sh
node scripts/verify-reference-live.cjs --live --url REAL_VINTED_URL --source REAL_PUBLIC_PRODUCT_URL --evidence /private/path/observed-evidence.json
```

Run it in the verified temporary/separate release checkout, never by rebuilding the active checkout. Evidence is optional; use only observed facts. It starts an isolated anonymous stdio MCP process and writes JSON/JPEG evidence to a temporary directory. It explicitly reports that actual ChatGPT acceptance remains pending. Results/inventory can change. See [recorded verification](reference-verification-results.md).

The observed active alias is `vinted`, profile `vinted-visual`, profile directory `/Users/neo/.config/tunnel-client`, launch target `/Users/neo/services/vinted-mcp-visual-outfit/start-stdio.sh`. Installed tunnel-client is `0.0.20`. No active launch/profile/secret/bundle was changed. The older verification report's `vinted-mcp-source` runtime path is historical and must not be used for this activation.

After review, prepare a permanent detached release (preparation does not switch the tunnel):

```sh
cd /Users/neo/services/vinted-mcp-visual-outfit
reviewed_commit="$(git rev-parse feat/visual-outfit-search)"
git worktree add --detach /Users/neo/services/vinted-mcp-reference-release "$reviewed_commit"
cd /Users/neo/services/vinted-mcp-reference-release
npm ci
npm run typecheck
npm run build
npm run bundle
npm test
cat > start-reference-stdio.sh <<'SH'
#!/bin/zsh
cd /Users/neo/services/vinted-mcp-reference-release
export VINTED_MCP_TRANSPORT=stdio
exec /opt/homebrew/bin/node dist/bundle.js
SH
chmod 700 start-reference-stdio.sh
```

First record the reviewed SHA, old bundle SHA256, launcher and a private backup of `/Users/neo/.config/tunnel-client/vinted-visual.yaml`. Keep existing credentials as file/env references; do not paste keys into commands, PRs or logs. Confirm the separate release advertises twelve tools and passes the stdio/image probe. No database or mandatory credential migration is needed.

**Only after explicit permission to switch the active connector**, perform these reviewed commands (verified against installed CLI help; not executed during development):

```sh
tunnel-client runtimes stop vinted
tunnel-client runtimes connect --alias vinted --profile vinted-visual --profile-dir /Users/neo/.config/tunnel-client --mcp-command /Users/neo/services/vinted-mcp-reference-release/start-reference-stdio.sh
tunnel-client runtimes status vinted
```

Reuse the existing alias, tunnel scope and credential references; do not create another remote tunnel, rotate keys or delete alias metadata. If existing account/scoping inputs are requested, use the backed-up runtime configuration rather than guessing them. The installed CLI supports `runtimes connect`, `stop`, `status`; there is no documented `runtimes update` command in this version.

Then open the existing custom connection's details in ChatGPT settings/Plugins, choose **Refresh**, confirm `find_product_reference_images` and twelve total tools, and start a new conversation. OpenAI documents [refresh after server metadata changes](https://developers.openai.com/plugins/deploy/connect-chatgpt) and the [Secure MCP Tunnel transport](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels). UI labels can vary by account. This is a custom MCP connection; published-plugin updates have a different publication/review flow.

In that actual ChatGPT conversation verify both distinct image blocks are visible, their Vinted/source links and indices are preserved, `similar_reference` stays labelled as another product, source-blocked and `allowSimilar:false` cases fall back correctly, and no product image describes the offered item's condition. Only that exercise can close scenario G. The existing eleven-tool image route working does not establish this new tool's acceptance.

Rollback after a failed activation: stop alias `vinted`, restore the private profile backup if needed, reconnect with the old launch target and verify health:

```sh
tunnel-client runtimes stop vinted
tunnel-client runtimes connect --alias vinted --profile vinted-visual --profile-dir /Users/neo/.config/tunnel-client --mcp-command /Users/neo/services/vinted-mcp-visual-outfit/start-stdio.sh
tunnel-client runtimes status vinted
```

Refresh the existing ChatGPT connection again and start a new conversation; confirm the previous eleven-tool catalog. The preserved old bundle stays available throughout. Do not merge the draft PR or publish an npm version as part of activation.
