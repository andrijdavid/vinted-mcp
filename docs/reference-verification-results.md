# Product-reference verification — 2026-11-10

Implemented on `feat/visual-outfit-search` for draft [upstream PR #3](https://github.com/andrijdavid/vinted-mcp/pull/3). This records what was actually exercised; fixture success is not a claim of live exact identification or completed ChatGPT acceptance. The [2026-11-09 report](verification-results.md) and its earlier results remain intact.

## Runtime protection

The working checkout is also the active runtime's launch directory: `/Users/neo/services/vinted-mcp-visual-outfit/start-stdio.sh` runs its `dist/bundle.js`. All builds/bundles/tests were therefore made in temporary copies through `npm run verify:isolated`, not over that bundle. Protected bundle/launcher/local-MCP-config hashes stayed unchanged. Tunnel alias `vinted`, profile `vinted-visual`, profile directory and credentials were not edited or restarted. Read-only tunnel status reported ready/healthy. No npm version was published; PR stays draft/unmerged.

## Automated verification

TypeScript typecheck, TypeScript build, esbuild bundle and default full test suite passed on Apple Silicon / Node 26.9.0. **Default suite: 73 passed, 0 failed, 1 opt-in live case skipped (74 total).** Existing checks for original tools, listing-photo content/resources, sizing/filtering, scoring, budget/risk logic, favourites and schemas remain in the suite.

New fixture coverage includes A–F below, product-code/GTIN checksums, explicit metadata profiles, brand/model/color matching, unrelated observed-label code, source tiers, ProductGroup variants, JSON-LD image association, Shopify same-handle galleries/multi-color rejection, on-model observations/captions/unknown views, fit criteria/differences, caller-only provenance, wrong/synthetic image observations, MIME/decoded formats/limits, timeout/error/cooldown behavior, cache/coalescing/content deduplication, public-DNS/socket pinning, lazy selection limits, provider requests and MCP schemas/mixed content. Native transport tests exercise DNS rejection before socket creation, pinned lookup and a deadline spanning a stalled response body.

The optional Brave adapter uses the real documented interface but only fixture responses were tested. No Brave subscription/key was enabled or charged. A fresh locally packed tarball was installed into a separate temporary directory; its stdio server advertised all twelve tools and included the new documentation/live-probe script. No npm publication was performed.

Separately, `RUN_LIVE_MCP_TESTS=1 node --test tests/mcp-server.test.cjs` passed **6/6**, including real search/item/seller/price-comparison/trending calls. It ran from an isolated built copy. No live favourite, purchase, payment or seller message occurred.

Upstream [PR checks](https://github.com/andrijdavid/vinted-mcp/pull/3/checks) reported `action_required`: Main Validation was gated on maintainer approval and had **zero jobs executed**, so upstream CI is not claimed as passed. Manual dispatch on the fork returned 404 because `main-validation.yml` is absent from its default branch; no default branch or workflow policy was changed. Local checks and the fresh package smoke test passed independently. A maintainer must approve upstream Actions before that CI gate can close.

## Controlled live Vinted checks

Actual connected `search_items`, `get_item` and `get_item_images` were used read-only before isolated new-tool probes. Examples:

| Vinted item | Data actually checked | Result/limit |
| --- | --- | --- |
| [10747214544 — Timberland Boots](https://www.vinted.nl/items/10747214544-timberland-boots) | €65, EU46, listing details, nine photo links; first three actual photos returned by existing connector and visually inspected | Wheat-looking boots; no observed readable product code. Seller has no reviews; this is a retrieval/reference test, not a buying recommendation. |
| [10502025986 — Truitje met v hals trussardi](https://www.vinted.nl/items/10502025986-truitje-met-v-hals-trussardi) | €20, L, brown, Tru Trussardi, V-neck category and five actual photo links; isolated new tool returned actual listing JPEG | V-neck is unsuitable for the requested crewneck outfit. Blocked source yielded `not_found`, preserving the listing photo. |
| [10395860615 — Trui tru trussardi](https://www.vinted.nl/items/10395860615-trui-tru-trussardi) | €15, L, grey, V-neck, seller/description/composition and four photo links | Different color/neckline; not claimed as the requested brown crewneck or an exact product match. |
| [10747380125 — Tommy Hilfiger brown V-neck jumper](https://www.vinted.nl/items/10747380125-tommy-hilfiger-tommy-hilfiger-brown-v-neck-knitted-jumper-size-l) | Isolated legacy live search/detail/photo/original-identification/assessment flow; JPEG 600×800, 42,471 bytes | Source-free original identification remained `not_identified`; visual score stayed null without actual comparison. It was a retrieval probe, not an approved outfit candidate. |

The targeted Trussardi rib-knit query returned no matching items in the bounded search. The target 10061 query initially returned no EU46 items in its small result slice. Broader searches found the items above; no wrong-size or wrong-neckline item was relabelled to fill the requested outfit.

## External product sources and actual images

1. [Timberland NZ — Men's 6-Inch Premium Waterproof Boot, Wheat](https://www.timberland.co.nz/products/mens-6-inch-premium-waterproof-boot-wheat): public page loaded successfully. ProductGroup contained 14 size variants; the documented same-handle Shopify Product API returned their vendor/SKUs/color and a product-bound image gallery. Three styled model photographs were downloaded, decoded and visually inspected. One shows a standing full model in baggy blue jeans; another shows a model standing in dark wide-leg jeans; the third shows boots/lower legs under dark denim in side/three-quarter views.
2. Actual validated model image used for the combined reference test: [Timberland source gallery — boots under denim](https://cdn.shopify.com/s/files/1/0603/7907/0599/files/Artboard7.jpg?v=1779077779). The tool returned a bounded 1000×1000 JPEG of **74,913 bytes**; it was not a generated image. Its source-page association came from the same-handle product gallery, not a Google image result.
3. [Timberland US — Men's Premium 6-Inch boot](https://www.timberland.com/en-us/p/men/footwear-10039/mens-timberland-premium-6-inch-waterproof-boot-TB110061713): public HTTP page loaded (671,075 bytes). JSON-LD product variants and a product image URL were found. No code observed on the Vinted label was available, so no live exact identification was established.
4. [DTLR — Timberland 6-Inch Premium Waterproof Boots](https://www.dtlr.com/products/timberland-6-inch-premium-waterproof-boots-wheat-10061): public HTTP page loaded (791,551 bytes), Timberland/Tan product data and **five product-image URLs** were parsed. These URL discoveries are not a claim that all five photos were downloaded, on-model or an exact Vinted match. Page text lists the style, but a retailer's internal SKU must not be silently treated as a manufacturer code.
5. [COS — dark brown cable-knit crewneck product page](https://www.cos.com/en-us/men/menswear/knitwear/crewneck/product/cable-knit-wool-crew-neck-jumper-dark-brown-1311695001): discovered through actual web search; server received **HTTP 403**. No browser challenge, alternate endpoint, proxy, credential or retry bypass was attempted. No COS reference image was returned as if fetched successfully.

## New-tool live stdio results

`verify-reference-live.cjs --live` started a separate built MCP server with an isolated anonymous HTTP profile and search-provider handoff mode. It did not touch the managed runtime.

- Timberland item **10747214544** plus the real NZ page and actual-image observations returned `similar_reference`, `onModel:true`, the separate actual Vinted photo (**600×800, 54,335 bytes**, content index 1) and source reference (**1000×1000, 74,913 bytes**, content index 2). Both decoded as JPEG; **zero errors** were reported. The observer described similar rounded toe, substantial lug sole, warm color and matte nubuck-like appearance. Differences included darker reference sole and listing lighting; shaft/height hidden by model trousers remained **unknown**. No label code, exact identity, material composition, comfort or authenticity was asserted.
- Trussardi item **10502025986** plus the COS URL returned **`not_found`**, no reference images, the actual listing JPEG (**619×800, 24,084 bytes**) and the explicit source HTTP 403 error. No fictitious replacement photo appeared.

The observed source images and comparison were real, while the algorithm's agreement tests are still fixtures rather than a calibrated human-labelled vision benchmark. The server validates source relationships and observations, not their truthfulness as an independent vision system.

## Existing five-part outfit fixture rerun

`verify-visual-live.cjs --live --outfit` ran **11:24:20–11:25:46 UTC** on 2026-11-10 with a one-second Vinted request delay. This is the existing text fixture, without an uploaded reference outfit photo.

| Part | Candidates | Requested size verified | Search strategies | Reported errors |
| --- | ---: | --- | ---: | ---: |
| Dark-brown textured crewneck sweater | 8 | 8 × L | 3 | 0 |
| White T-shirt | 5 | 5 × L (fixture assumption) | 3 | 0 |
| Light-beige washed baggy jeans | 3 | 3 × W32 | 3 | 0 |
| Wheat boots | 1 | 1 × EU46 | 3 | 0 |
| Subtle gold-colored chain | 5 | Not requested | 3 | 0 |

Three provisional combinations had listing subtotals **€82, €83, €85**. Shipping, buyer protection and final totals stayed unknown. This does not demonstrate a fully reviewed outfit under €100 at checkout. The new external-reference lookup was exercised separately on the shortlisted Timberland listing; the outfit rerun did not fetch references for every result.

## Acceptance matrix

| Scenario | Fixture/protocol evidence | Live evidence | Remaining gap |
| --- | --- | --- | --- |
| A — exact official product + model | Passed: actual-listing label URL/code, source brand/color, bound model image and explicit exact status | Official pages/images fetched; no real matching label code established | Live exact labelled-product confirmation still open |
| B — retailer source | Passed: source B, correct page/domain, code/color proof and exact/probable limits | DTLR page and five bound product-image URLs discovered | Live retailer-to-Vinted identity with observed code still open |
| C — different-product fit reference | Passed: vintage Trussardi versus COS fixture, required real-image citations and `allowSimilar:false` | Real Timberland on-model reference returned with explicit similar status and differences | No suitable vintage brown Trussardi crewneck/model pair established live |
| D — wrong model/color/imagery | Passed: conflicting variants, unrelated caller photos and declared synthetic content excluded from identity | Wrong-neckline/color Trussardi results were not treated as the target outfit | No automated independent vision classification claimed |
| E — no result | Passed: empty/missing/invalid images, unknown sources and allowSimilar=false fallback | Trussardi/COS call retained only the actual listing image | Inventory/source coverage remains bounded |
| F — blocked source | Passed: no retry/bypass, cooldown, browser-only evidence cannot become exact | Real COS HTTP403 with clean `not_found` fallback | Broader source availability is not guaranteed |
| G — ChatGPT delivery | Official SDK in-memory and actual stdio deliver distinct decodable Vinted/reference blocks and structured provenance | Existing eleven-tool connector delivered three actual Timberland images visible in this conversation | **New twelve-tool connector is not activated/refreshed; actual ChatGPT acceptance remains open** |

## Remaining limits and activation

Automated discovery is optional and unavailable by default; ChatGPT browsing handoff is required in that mode. Unsupported domains/redirects/IPv6-only sources fail closed. Structured product data can be incomplete or wrong. Caller claims, captions and visual comparisons are explicitly attributed, not independently validated vision. Unlabelled AI imagery cannot be perfectly detected without additional evidence. There is no guarantee of one reference for every listing, exact identity or checkout budget.

Follow the [reviewable activation and rollback steps](product-references.md#verification-and-safe-activation) only after permission to switch the active connector. Refresh the custom connection's tool list, start a new ChatGPT conversation and verify both images, identity labels, wrong-source/no-result handling and condition separation. Successful local tests and the existing connector's image support do not close that gate.
