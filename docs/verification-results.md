# Verification results — 2026-11-09

This is a development implementation with explicit acceptance gaps, not a claim of completed visual acceptance in ChatGPT. The active Mac mini installation, its start script, browser profile and OpenAI tunnel were not changed. Development starts from upstream commit `992d476` on `feat/visual-outfit-search` in an isolated clone.

## Completed checks

- TypeScript `typecheck`, build and esbuild bundle passed on Apple Silicon, Node 26.9.0.
- Offline tests: 39 passed, zero failures; one additional legacy live test is opt-in in the default run. Tests cover filters, taxonomy, normalization, metadata and visual observation scoring, original-product evidence, deduplication, budget combinations/rounding, seller/listing flags, missing data, timeouts, CDN restrictions, format/size validation, cache behavior, canonical redirects, existing favourite behavior and SDK protocol compatibility. The default test run skips the explicitly opt-in legacy live case; the separate live case was also run and passed.
- An official MCP SDK client tested stdio discovery, existing resources/prompts, mixed image/text content, structured content, binary resource reads and tool argument errors. The five new tools are advertised as read-only. No purchase, payment, message or live favourite action was executed.
- Existing live protocol flow passed all six tests: search, item, seller, price comparison and trending, in addition to discovery/resources/prompts. The tests used an isolated anonymous HTTP profile path rather than the active user's browser profile.
- The real public catalog page established the category snapshot and revealed incorrect IDs in the previous static resource. Item-page parsing was also checked against actual public JSON-LD and React payloads.
- A fresh package installation was exercised separately, including the native image dependency and stdio tool discovery. No package was published to npm.
- The real-photo export fallback was also run against an actual listing: three JPEGs and a provenance manifest were saved outside the repository. All three decoded successfully, stayed within the resolution limit and retained the correct listing/item mapping. Actual attachment and viewing in the user's ChatGPT conversation remain a separate acceptance step.

## Controlled live outfit run

Run: `node scripts/verify-visual-live.cjs --live --outfit`, 21:37:54–21:39:16 UTC, with a one-second request delay. This tested **the text fixture**, not an uploaded reference image. Detailed raw artifacts remain local in the temporary verification directory rather than Git.

| Component | Returned candidates | Exact requested size | Completed search strategies |
| --- | ---: | ---: | ---: |
| Sweater | 8 | 8 (L) | 3 |
| White T-shirt | 5 | 5 (L; test assumption for unspecified T-shirt size) | 3 |
| Jeans | 4 | 4 (W32) | 3 |
| Boots | 1 | 1 (EU46) | 3 |
| Chain | 5 | Size not requested | 3 |

This run returned three **provisional** five-part combinations. The leading listing subtotal was €57.90. Shipping and buyer protection were unknown, so the final total was null and no complete checkout price below €100 was claimed. These are retrieval/optimization observations, not recommendations or confirmed outfit likeness.

The prototype run exposed a slim-model false positive, conflicting title size labels and costume jewellery. Follow-up filters now reject known slim Levi's models for baggy requests and explicit conflicting title sizes, preserve W32 when a title also includes its FR size, and the fixture explicitly requests a subtle thin chain while excluding plastic/costume/tie items. These follow-up safeguards have unit coverage; the table above describes that recorded live run, not guaranteed inventory for the final branch. Results and availability naturally change.

An earlier run received item-page 429 responses. Detail requests now stop on access restrictions and share origin cooldowns rather than continuing through the enrichment list. The later slower run had no reported detail/search errors. Access restrictions were never bypassed.

## Actual photo evidence

The stdio MCP client received and decoded an actual listing JPEG, 600×800 pixels, 82,867 bytes, retaining its original Vinted CDN URL and listing ID. A previous downloaded real listing image was also visually inspected through the local image viewer; it showed a dark cable-knit crewneck on a hanger. This establishes real image retrieval and local viewing only. No reference outfit photo was supplied, so neither observation establishes a reference/candidate match.

The existing ChatGPT connector still advertises its original tools. The new tools were **not** installed into that live connector during development. Whether tunnel-client 0.0.20 plus that particular connector forwards MCP image/resource blocks to ChatGPT's vision input remains untested. Use the staged test and actual-photo export/attachment fallback in [the implementation guide](visual-outfit-search.md).

## Product identification and score limits

Identifier extraction, official host constraints, code/brand agreement, caller-observed label evidence, similar-versus-exact distinction, missing data and original-price honesty passed fixture tests. A real Levi's manufacturer-page request returned 403 and was not bypassed. Live listings without verifiable original-product evidence correctly returned `not_identified`. Actual exact identification of an outfit item is not demonstrated. ChatGPT browsing can supply source URLs or clearly labelled source observations; the server never upgrades browser-only facts to an exact confirmation.

Visual scoring arithmetic, weights, provenance constraints and positive/negative/partial observations passed tests. The observations in these tests are fixtures, not a calibrated human-labelled image benchmark. Scores are approximate feature agreement rounded to steps of five. Without an actual image review the score is null. Seller risk is a heuristic review aid, not authentication or a fraud verdict.

## Acceptance still requiring real user/host input

- Actual reference outfit image supplied and interpreted in ChatGPT.
- Candidate photos visibly accessible to the model via the actual staged connector, or exported real photos attached using the fallback.
- Evidence-backed visual comparison of reference and listings, including fit/texture/shape/condition, rather than metadata-only relevance.
- At least five genuinely suitable jeans/boots in the requested sizes where available: the bounded run did not meet that threshold, and the tool reports the shortfall rather than filling it with wrong sizes/models.
- Verified original-product identity where sufficient label/source evidence exists.
- A complete **visually reviewed** outfit with verified final checkout costs no higher than €100. Only provisional listing-subtotal combinations were demonstrated.

The server-side implementation, offline checks and controlled real-listing flow are reviewable. The full visual acceptance scenario is not yet passed. No production switch or merge has been performed.
