#!/usr/bin/env node
// Export actual MCP photo bytes for ChatGPT attachment when the host hides image blocks.
const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function main() {
  const [id, country = 'nl', destination] = process.argv.slice(2);
  if (!/^\d+$/.test(id || '')) throw Error('Usage: node scripts/export-item-images.cjs ITEM_ID COUNTRY [NEW_EXPORT_DIRECTORY]');
  const output = path.resolve(destination || path.join('exports', `${country}-${id}-${Date.now()}`));
  // Never overwrite an existing export or arbitrary file.
  await fs.mkdir(output, { recursive: false, mode: 0o700 }).catch(async error => {
    if (error.code !== 'ENOENT') throw error;
    await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    await fs.mkdir(output, { mode: 0o700 });
  });
  const client = new Client({ name: 'vinted-photo-export', version: '1' }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/bundle.js')], cwd: process.cwd(), env: { ...process.env, VINTED_MCP_TRANSPORT: 'stdio' } });
  try {
    await client.connect(transport);
    const response = await client.callTool({ name: 'get_item_images', arguments: { itemId: Number(id), country, maxPhotos: 3, includeContent: true } });
    if (response.isError) throw Error(response.content[0].text);
    const metadata = response.structuredContent || JSON.parse(response.content[0].text);
    let count = 0;
    for (const photo of metadata.images) {
      if (!photo.contentIncluded) continue;
      const content = response.content[photo.contentIndex];
      if (content?.type !== 'image' || content.mimeType !== 'image/jpeg') throw Error('Unexpected image response');
      const filename = `${count + 1}.jpg`;
      await fs.writeFile(path.join(output, filename), Buffer.from(content.data, 'base64'), { flag: 'wx', mode: 0o600 });
      photo.exportedFile = filename;
      count++;
    }
    await fs.writeFile(path.join(output, 'provenance.json'), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    if (!count) throw Error('No photo bytes available; see provenance.json for errors');
    console.log(`Exported ${count} actual listing photos to ${output}. Attach the JPEGs to ChatGPT and retain provenance.json for item/URL mapping.`);
  } finally { await client.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
