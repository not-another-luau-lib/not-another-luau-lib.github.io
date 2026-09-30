// Generates the API reference of every library into content/docs/(libraries)/<slug>.
//
//   node scripts/generate.mjs [librariesDir]
//
// librariesDir holds one folder per library, each with its own fumablox.toml.
// CI clones every repo of the org into ./libraries; locally, point it at ../libraries.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';

const fumablox = path.resolve(import.meta.dirname, '../node_modules/@metricsrb/fumablox/dist/cli.js');
const librariesDir = path.resolve(process.argv[2] ?? 'libraries');
const outRoot = path.resolve('content/docs/(libraries)');

if (!fs.existsSync(librariesDir)) {
  console.error(`✗ no libraries directory at ${librariesDir}`);
  process.exit(1);
}

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });

const slugify = (name) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .toLowerCase();

const libraries = fs
  .readdirSync(librariesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(librariesDir, entry.name))
  .filter((dir) => fs.existsSync(path.join(dir, 'fumablox.toml')))
  .sort();

const pages = [];

for (const dir of libraries) {
  const config = parse(fs.readFileSync(path.join(dir, 'fumablox.toml'), 'utf8'));
  const title = config.title ?? path.basename(dir);
  const slug = slugify(path.basename(dir));
  const out = path.join(outRoot, slug);

  console.log(`> ${title} -> ${path.relative(process.cwd(), out)}`);
  // Run from the library so source links are relative to its repo root.
  execFileSync(process.execPath, [fumablox, 'generate', '--config', 'fumablox.toml', '--out', out], {
    cwd: dir,
    stdio: 'inherit',
  });

  const metaPath = path.join(out, 'meta.json');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
  fs.writeFileSync(metaPath, JSON.stringify({ ...meta, title }, null, 2) + '\n');
  pages.push(slug);
}

fs.writeFileSync(path.join(outRoot, 'meta.json'), JSON.stringify({ title: 'Libraries', pages }, null, 2) + '\n');

if (libraries.length === 0) {
  console.warn(`! no library with a fumablox.toml in ${librariesDir}`);
}
