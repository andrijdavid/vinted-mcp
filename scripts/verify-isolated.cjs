#!/usr/bin/env node
// Build/test away from a checkout whose dist/bundle.js may be the active stdio runtime.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'vinted-reference-check-'));
const protectedFiles = ['dist/bundle.js', 'start-stdio.sh', 'mcp.local.json'];
const digest = file => fs.existsSync(path.join(root, file)) ? crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') : null;
const before = protectedFiles.map(digest);
for (const file of ['src', 'tests', 'scripts', 'docs', 'package.json', 'package-lock.json', 'tsconfig.json', 'README.md', 'LICENSE.md', '.env.example']) {
  fs.cpSync(path.join(root, file), path.join(stage, file), { recursive: true });
}
fs.symlinkSync(path.join(root, 'node_modules'), path.join(stage, 'node_modules'), 'dir');
console.log(`Isolated verification directory: ${stage}`);
let code = 0;
try {
  for (const command of ['typecheck', 'build', 'bundle', 'test']) {
    const result = spawnSync('npm', ['run', command], { cwd: stage, env: process.env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status) { code = result.status; break; }
  }
} finally {
  assert.deepEqual(protectedFiles.map(digest), before, 'Protected production files changed');
  console.log('Active bundle, launcher and local MCP configuration hashes unchanged.');
  console.log(`Artifacts retained for review: ${stage}`);
}
process.exitCode = code;
