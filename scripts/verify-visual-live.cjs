#!/usr/bin/env node
// Explicit opt-in, read-only anonymous checks. No active profile/tunnel is used.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const sharp = require('sharp');

async function main() {
  if (!process.argv.includes('--live')) throw Error('Explicit --live is required. Optional --outfit runs the five-part metadata fixture.');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vinted-visual-verification-'));
  const report = { startedAt: new Date().toISOString(), transport: 'stdio', auth: 'anonymous_http_isolated_profile_path', referenceImageProvided: false, checks: [] };
  const client = new Client({ name: 'visual-live-check', version: '1' }, { capabilities: {} });
  const env = { ...process.env, VINTED_MCP_TRANSPORT: 'stdio', VINTED_AUTH_MODE: 'http', VINTED_PROFILE_DIR: path.join(root, 'unused-profiles'), VINTED_MAX_RETRIES: '1', VINTED_REQUEST_DELAY_MS: '1000' };
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/bundle.js')], cwd: process.cwd(), env });
  async function call(name, args) {
    const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 240000 });
    if (response.isError) throw Error(`${name}: ${response.content[0].text}`);
    return { response, data: response.structuredContent || JSON.parse(response.content[0].text) };
  }
  try {
    await client.connect(transport);
    const list = await client.listTools();assert.ok(list.tools.find(t => t.name === 'get_item_images'));
    report.checks.push({ name: 'tool_discovery', tools: list.tools.length, passed: true });
    const search = (await call('search_items', { query: 'bruine trui', country: 'nl', categoryId: 79, limit: 5, includePhotos: true })).data;
    assert.ok(search.items.length);const item = search.items.find(i => i.photos?.length);assert.ok(item);
    report.checks.push({ name: 'search_items', passed: true, count: search.items.length, itemId: item.id, realUrl: item.url });
    const detail = (await call('get_item', { itemId: item.id, country: 'nl' })).data;
    assert.ok(detail.title);assert.ok(detail.photos.length);assert.ok(detail.price);
    report.checks.push({ name: 'get_item', passed: true, size: detail.size, condition: detail.condition, photos: detail.photos.length, sellerReputationAvailable: detail.seller.rating !== null });
    const photos = await call('get_item_images', { itemId: item.id, country: 'nl', maxPhotos: 1, includeContent: true });
    const block = photos.response.content.find(c => c.type === 'image');assert.ok(block, JSON.stringify(photos.data));
    const imageBytes = Buffer.from(block.data, 'base64');const dimensions = await sharp(imageBytes).metadata();
    assert.ok(dimensions.width <= 1000 && dimensions.height <= 1000);await fs.writeFile(path.join(root, 'actual-listing.jpg'), imageBytes);
    report.checks.push({ name: 'mcp_image_content', passed: true, width: dimensions.width, height: dimensions.height, bytes: imageBytes.length, sourceUrl: photos.data.images[0].url, hostVisibility: 'MCP client bytes decoded; ChatGPT connector rendering not tested' });
    const original = (await call('find_original_product', { itemId: item.id, country: 'nl' })).data;
    assert.equal(original.status, 'not_identified');report.checks.push({ name: 'honest_original_identification_without_sources', passed: true, status: original.status });
    const assessed = (await call('assess_visual_match', { itemId: item.id, country: 'nl', category: 'sweater', reference: { color: 'dark brown' } })).data;
    assert.equal(assessed.visualMatch.score, null);report.checks.push({ name: 'no_fabricated_visual_score', passed: true });
    if (process.argv.includes('--outfit')) {
      const fixture = require('../tests/fixtures/example-outfit.json');
      const result = (await call('find_similar_outfit', fixture)).data;
      await fs.writeFile(path.join(root, 'outfit-result.json'), JSON.stringify(result, null, 2));
      for (const part of result.parts) for (const candidate of part.candidates) {
        assert.notEqual(candidate.sizeStatus, 'mismatch');assert.equal(candidate.visualMatch.score, null);assert.match(candidate.url, /^https:\/\/www\.vinted\.nl\/items\//);
      }
      report.checks.push({ name: 'outfit_metadata_fixture', passed: true, status: result.status, combinations: result.combinations.length,
        parts: result.parts.map(p => ({ id: p.id, candidates: p.candidates.length, exactSizes: p.candidates.filter(c => c.sizeStatus === 'exact').length, completedStrategies: p.completedStrategies, errors: p.errors.length })),
        budgetStatus: result.combinations[0]?.budgetStatus || null, visualAcceptance: 'NOT_TESTED_NO_REFERENCE_PHOTO' });
    }
  } finally {
    await client.close();report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ artifacts: root, ...report }, null, 2));
  }
}
main().catch(error => { console.error(error.message);process.exitCode = 1; });
