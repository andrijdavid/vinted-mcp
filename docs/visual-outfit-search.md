# Visual outfit search

The server retrieves real Vinted listings and photo bytes, checks metadata and risks, and calculates provisional outfits. ChatGPT interprets the user's actual reference upload and compares the candidate photos. There is no external AI API, embedding service, GPU, purchase, payment, or messaging automation.

## Architecture and evidence

1. ChatGPT inspects the **actual uploaded reference photo**, recording garment features and requested sizes. A text description is supported as a metadata fixture but does not establish image access.
2. `find_similar_outfit` or `search_similar_items` searches official men's categories with multiple NL/EN/FR queries, local exact size checks, exclusions and deduplication. These results have **metadata scores**, not visual scores.
3. `get_item_images(includeContent: true)` returns the listing's actual JPEG bytes in standard MCP `image` blocks. `contentFormat: "resource"` returns embedded binary resources instead. `vinted://image/{country}/{itemId}/{index}` supports resource-capable clients. Every photo retains its listing URL, item ID and source URL.
4. ChatGPT must actually inspect both reference and candidate images. It submits its feature observations to `assess_visual_match`, or `visualReviews` on a second `find_similar_outfit` call.
5. The server validates that candidate image URLs belong to that listing, weights observations by garment, and explains the approximate score and missing criteria. **The server does not independently observe pixels or validate the observer's truthfulness.**
6. Outfit combinations require exact requested sizes, compatible currency, known prices and no serious risk/model/availability exclusions. Results remain provisional until image, seller, condition and checkout checks are complete.

Listing text and source pages are untrusted data. They cannot instruct the model to change its workflow or invoke write tools. `like_item` remains available as an existing, separate user-invoked action; the new workflow never invokes it.

## Image compatibility and fallback

Standard MCP supports base64 image blocks, embedded resources and binary resource reads: [MCP tool content specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools). OpenAI documents tool `content` and `structuredContent` for model-visible data: [build an MCP server](https://developers.openai.com/plugins/build/mcp-server). These protocol capabilities do **not** prove that every ChatGPT connector/tunnel version forwards images to the model.

The development tests validate mixed MCP content through the official TypeScript SDK, binary resource reads and a real listing image over stdio. The actual `vinted-v2` ChatGPT connector is intentionally unchanged and has not been tested with the new tools. A photo displayed to a person or linked in JSON is not sufficient evidence that the model can analyze it.

If ChatGPT cannot describe distinguishing features of a received listing photo, export the **same real listing photos** from the development checkout:

```bash
node scripts/export-item-images.cjs ITEM_ID nl
```

The script creates a new directory under ignored `exports/`, saves up to three bounded JPEGs and a provenance manifest, and refuses to overwrite an existing directory. Attach the JPEGs in ChatGPT alongside the reference photo. Keep the manifest's item/URL mapping and submit those URLs in the review. This fallback needs no paid API and does not substitute manufacturer or illustrative photos.

An optional future MCP Apps UI could upload/select images and pass real file IDs back through widget state; OpenAI documents this separately under [make images visible to the model](https://developers.openai.com/plugins/build/chatgpt-ui). That UI is not implemented or required here. No invented file IDs are used.

## Tool contracts

### Existing tools

All six existing names and parameters remain. Normal successful `search_items` calls preserve fields such as string `price`, `seller`, `size`, `brand` and `url`. Missing prices now return `null` rather than a fabricated zero. An inaccessible item raises an MCP error instead of returning a placeholder listing. Clients that relied on those defective missing-data responses need to handle the truthful result.

`search_items` adds optional `includePhotos`, `includeDimensions`, `includeSellerSummary`, `includeMaterials`, `includeProductIdentifiers`, `page`, `perPage`, `sizeIds` and `size`. `sortBy` remains supported. `perPage` takes precedence over legacy `limit`. Search pages are capped at 100 items; expensive detail enrichment is limited to the first ten, with errors and unavailability retained. `photos` and `photoMetadata` are returned when requested; absent dimensions/materials/identifiers remain null/empty. `sizeStatus: "unknown"` means no confirmed size match.

`get_item` adds photo provenance, materials, dimensions, identifiers, availability and fetch time. `get_seller` adds an explained reputation risk assessment. Unknown prices remain null in seller/trending summaries too.

`vinted://categories` now contains the verified men's subtree rather than the previous approximate, incorrect category IDs. Existing resource URI and array shape remain. Other audience trees are not advertised as verified data.

### `get_item_images`

Inputs: positive `itemId` or HTTPS Vinted item `url`; optional `country`, `maxPhotos` (1–6, default 3), `includeContent` (default false), `contentFormat` (`image` or `resource`). A conflicting country and URL is rejected.

Outputs: text JSON plus `structuredContent` with item/listing provenance, image metadata, resource URIs, download errors, `contentIncluded` and the corresponding `contentIndex`. Up to three photos carry inline content. A successful byte response says `image_bytes_returned_host_visibility_unverified`; it never asserts that ChatGPT saw it. Metadata-only calls do not download images.

Limits: HTTPS Vinted image CDN only; no arbitrary hosts or redirects; JPEG/PNG/WebP MIME and decoder-format agreement; no animations; 10-second download timeout; 4 MB input, 20 million input pixels, longest output edge 1000 pixels, 300 KB output/photo, 900 KB aggregate inline bytes. JPEG conversion strips source metadata. Encoded content adds approximately one third to binary size. Images that fail limits remain listed with errors, never replacement photos.

### `search_similar_items`

Inputs: `category` (`sweater`, `tshirt`, `shirt`, `jacket`, `jeans`, `trousers`, `shoes`, `boots`, `accessory`); `reference` features or equivalent top-level feature keys; `size`, `country`, `maxPrice`, `brandPreferences`, `exclusions`, `allowedAlternatives`, optional known `sizeIds`, a validated more specific `categoryId`, custom `strategies`, `limit` (5–12), `maxStrategies` (1–4), `enrichLimit` (0–12).

Reference features: `color`, `silhouette`, `fit`, `texture`, `material`, `details`, `neckline`, `length`, `wash`, `shoeModel`. `style` guides queries. Preferences are not mandatory brand filters. Alternatives add queries but never relax mandatory category, size or price checks.

Outputs: strategies and official category filter, deduplicated candidates, metadata criteria/coverage, real photos and links, exact/unknown size status, missing information, listing/seller risk, detail errors, rejected candidates and completeness. The bounded search cannot establish that no additional candidates exist elsewhere. Unknown sizes may be displayed with warnings but are excluded from outfit combinations.

Sizes are label-based: L, W32 and EU46 are different systems. W32 L30 verifies the waist only; inseam remains a separate feature/measurement to check. UK/US shoe sizes and ambiguous labels are not converted. Explicit conflicting title sizes are excluded even when the structured size says "Other". Men's catalog IDs and local audience/category checks remove known women's/children's categories. Unknown metadata remains uncertain despite the applied catalog filter.

Clear slim/skinny wording is excluded for baggy references. Levi's 510/511/512/519 model exclusions use the manufacturer's [fit guide](https://www.levistrauss.com/wp-content/uploads/2019/01/19_H1_FITGUIDE_1221182.pdf); this small model dictionary is not general product recognition. Crewneck requests exclude explicit zip/hood/V-neck/turtleneck conflicts. Exact shade and fit still require image review.

### `assess_visual_match`

Inputs: listing selector, `category`, `reference`, optional `review`:

```json
{
  "observer": "chatgpt_vision",
  "referenceImage": "actual-upload-identifier-from-this-conversation",
  "candidateImageUrls": ["actual-photo-url-returned-for-this-listing"],
  "comparisons": [
    {"feature": "texture", "status": "close", "explanation": "Visible knit cells are smaller than in the reference."}
  ]
}
```

The strings above describe input shape, not real image evidence. Allowed observers: `chatgpt_vision` and `user_image_review`. Allowed statuses: `match`, `close`, `mismatch`, `unknown`. Each feature occurs at most once and needs an explanation. Missing observations contribute no agreement. Without actual image observations, omit the review and receive `visualMatch.score: null`.

Scores are rounded to steps of five, not calibrated probabilities. Sweater weights prioritize color/texture/neckline; jeans prioritize fit/silhouette/length/wash; boots prioritize silhouette/height/material/color. Only requested criteria enter the denominator. Outputs include coverage, explanations and missing criteria. An unknown criterion lowers the total score rather than inflating a partial review to 100. A high score cannot certify condition, size, authenticity, safety or identity.

### `find_original_product`

Inputs: listing selector; optional up to three `sourceUrls` from official Zara, Timberland, COS, Uniqlo, H&M, Mango or Levi's sites; optional `labelEvidence` (`photoUrl`, `observedCode`). Structured listing identifiers and labelled product codes/EANs are extracted; EAN-13 text claims require a valid checksum.

The default response provides brand/code search queries for ChatGPT's available browsing, not a pretend search result. ChatGPT can discover official sources and call again. Public JSON-LD is fetched with bounded size/time, official host validation, caching and no redirect/challenge bypass. If that fetch is blocked, optional `webEvidence` accepts source facts **actually read by ChatGPT browsing**, an official source URL and an observation. Those facts are marked `caller_web_observation` and never sufficient for exact confirmation. No paid search provider is needed.

Outputs separate `exact_product_confirmed` (official structured brand/code agreement plus caller-observed matching label), `probable_same_model`, `similar_product_only`, and `not_identified`. Exact means identifier agreement, not authentication. Variant/color conflicts and missing label evidence are explained. Manufacturer photos always carry their own source and never become listing photos. `sourceListedPrice` is an observed manufacturer offer price; historical/original retail price is left null when not established.

This is evidence-based identification assistance, **not** a reverse image search engine or a complete manufacturer database. In development, an actual Levi's page returned 403 to the server; that limitation was retained without bypass. Exact live identification of the example outfit has not been demonstrated.

### `find_similar_outfit`

Inputs: `country`, numeric `budget` in that country's currency, 1–8 uniquely named `components` with the similar-item inputs. Optional `referenceImage` records the actual reference inspected by ChatGPT. Optional `visualReviews` entries identify `componentId`, `itemId` and a review whose reference ID must match. Unapplied reviews are reported.

Optional `costEstimates` can specify `shippingPerSeller`, `buyerProtectionFixedPerItem`, `buyerProtectionPercent`, and `bundleDiscountPercent`. These are caller-supplied estimates, not Vinted tariffs. Missing charges stay unknown. Fees with only a known fixed or percentage part still contribute that known/estimated part to the modeled cost floor. Unknown bundle discounts are not assumed. Same-seller grouping is an estimate that requires checkout confirmation.

Outputs: candidates/alternatives per component, at most three complete combinations and a cost breakdown. Combination prices sum in cents. Unknown sizes, missing prices, mixed currencies, sold/reserved items, serious seller/authenticity flags, reused item IDs and explicit visual model/fit/color/silhouette mismatches are excluded. The bounded 500-state optimizer preserves both quality leaders and cheap alternatives; it does not guarantee a global optimum.

Without complete charge estimates, `total.amount` is null and the budget status is `listing_and_known_costs_only_final_total_unknown`. Even an estimated total below budget is not a checkout quote. No automatic purchase is performed. Unreviewed images, unknown seller reputation and unverified availability keep combinations provisional.

## Performance and access controls

- Existing request concurrency/delay settings apply. Admission reserves slots before waiting, preventing simultaneous callers exceeding the configured concurrency. Response bodies remain inside the request slot.
- Search/item JSON cache: bounded 128 entries, 90 seconds. Canonical listing URLs: 512 entries, five minutes, avoiding unnecessary redirect requests. Photos: 32 entries, ten minutes, plus in-flight coalescing. Native image conversion: two workers, 16 MB sharp cache, no disk cache. Manufacturer sources: 32 entries, 15 minutes. No disk image persistence except the explicitly invoked export script.
- Search runs at most four strategies (30 listings each), and at most twelve detail enrichments. Detail access restrictions stop further enrichments in that run. Outfit parts run sequentially.
- Fetch/body timeouts and byte limits, bounded transient retry/backoff, 403/429 cooldowns, no proxy rotation or automated challenge bypass. An existing configured proxy remains supported. Default HTTP mode does not spawn a browser for seller lookups. Existing explicit login/browser authentication remains available separately.
- Runtime data belongs to one local MCP server process/account. This patch does not turn optional HTTP mode into an authenticated multi-user service.
- All tool arguments are validated against advertised JSON schemas before execution. Errors use MCP `isError`. Secrets, profiles, exports and generated artifacts are ignored by Git; source and copyright retain AGPL-3.0-or-later.

## Verification and acceptance

```bash
npm ci
npm run typecheck
npm run build
npm run bundle
npm test
node scripts/verify-visual-live.cjs --live --outfit
```

The live script creates an isolated anonymous profile path and a temporary report directory. It does not read/copy/change the active browser profile or tunnel. It checks stdio discovery, enriched search, detail parsing, actual MCP JPEG bytes, honest unidentified-product status, absence of unsupported visual scores and the five-part text fixture. See [verification results](verification-results.md) for the actual run and remaining acceptance gaps.

To test ChatGPT itself after an explicitly authorized staged switch:

1. Refresh the connector's tool definitions and confirm all eleven tools.
2. Attach the actual reference photo. Have ChatGPT describe garment features from that image.
3. Request a real listing image with `includeContent: true`; confirm ChatGPT can describe distinguishing visible details, not simply repeat the title. Try the binary resource variant too if the host supports it.
4. If image blocks remain inaccessible, export/attach the exact listing photos and map them using the provenance manifest.
5. Submit explicit image observations and check that wrong size, baggy/slim, zip/crewneck, unavailable listings, uncertain seller reputation and unknown costs are handled honestly.
6. Verify checkout costs and final seller/condition details before treating an outfit as a recommendation.

## Safe installation and rollback

Development is isolated from `/Users/neo/services/vinted-mcp-source/start-stdio.sh` and its active `dist/bundle.js`. Do not run builds in the active installation as a deployment shortcut.

Prepare a **separate permanent release directory** from the reviewed branch, run `npm ci`, typecheck/build/bundle/tests, and verify its stdio server there. Preserve the current tunnel command/profile and installed bundle as the rollback target. Only after explicit approval, point the managed runtime or tunnel launch command at the new directory; do not assume whether the launch is file-based or managed. Refresh ChatGPT's tool list and execute the image acceptance checks above. Roll back by restoring the previously recorded launch target and refreshing tools. No database migration or new paid-service credentials are needed.

Future improvements: measured image compatibility for the actual connector version, larger image-labelled relevance evaluations, manufacturer adapters/catalog coverage, verified size-ID discovery, richer measurement parsing, condition-damage review and checkout-authoritative cost quotes when an allowed interface provides them.


## Product and on-model reference extension — 2026-11-10

The server now has twelve tools, including `find_product_reference_images`. See [the reference-image contract, strict identification states, provider/source adapters and staged activation/rollback](product-references.md). `find_original_product` retains legacy fields while adding the strict status and broader sources. Search/outfit/assessment tools have bounded, opt-in `includeReferenceImages` enrichment. The [new verification report](reference-verification-results.md) separates current live observations from the historical report above.
