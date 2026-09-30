// Generates the docs of every published library into content/docs/(libraries)/<slug>,
// and the list shown on the landing page into content/libraries.json.
//
//   node scripts/generate.mjs [librariesDir] [--all]
//
// librariesDir holds one folder per library, each with its own fumablox.toml.
// CI clones every repo of the org into ./libraries; locally, point it at ../libraries.
// A library is listed once its gitRepoUrl is a public GitHub repository; --all lists
// the others too, to preview them locally. Versions come from ember, pesde and wally.
// Set GH_TOKEN to avoid GitHub's rate limit.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';

const fumablox = path.resolve(import.meta.dirname, '../node_modules/@metricsrb/fumablox/dist/cli.js');
const args = process.argv.slice(2);
const includeUnpublished = args.includes('--all');
const librariesDir = path.resolve(args.find((arg) => !arg.startsWith('--')) ?? 'libraries');
const outRoot = path.resolve('content/docs/(libraries)');
const listPath = path.resolve('content/libraries.json');

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

const readToml = (file) => (fs.existsSync(file) ? parse(fs.readFileSync(file, 'utf8')) : undefined);

const compareVersions = (a, b) => {
  const pa = a.split(/[.+-]/).map(Number);
  const pb = b.split(/[.+-]/).map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
};

const latest = (versions) => versions.filter(Boolean).sort(compareVersions).at(-1);

async function fetchJson(url, headers = {}) {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    return response.ok ? await response.json() : undefined;
  } catch (error) {
    console.warn(`! ${url}: ${error.message}`);
    return undefined;
  }
}

// Each registry: where the package name lives in the library, and how to find its latest version.
const registries = {
  ember: {
    name: (dir) => readToml(path.join(dir, 'ember.toml'))?.package?.name,
    version: async (name) => {
      const data = await fetchJson(`https://api.luaupm.com/v1/packages/${name}`);
      return latest(Object.values(data?.versions ?? {}).map((v) => v.version));
    },
    url: (name) => `https://luaupm.com/package?name=${encodeURIComponent(name)}`,
    dependency: (alias, name, version) => `${alias} = { name = "${name}", version = "^${version}" }`,
  },
  pesde: {
    name: (dir) => readToml(path.join(dir, 'pesde.toml'))?.name,
    version: async (name) => {
      const data = await fetchJson(`https://registry.pesde.dev/v1/packages/${encodeURIComponent(name)}`);
      return latest(Object.keys(data?.versions ?? {}));
    },
    url: (name) => `https://pesde.dev/packages/${name}`,
    dependency: (alias, name, version) => `${alias} = { name = "${name}", version = "^${version}" }`,
  },
  wally: {
    name: (dir) => readToml(path.join(dir, 'wally.toml'))?.package?.name,
    version: async (name) => {
      const data = await fetchJson(`https://api.wally.run/v1/package-metadata/${name}`);
      return latest((data?.versions ?? []).map((v) => v.package?.version));
    },
    url: (name) => `https://wally.run/package/${name}`,
    dependency: (alias, name, version) => `${alias} = "${name}@^${version}"`,
  },
};

async function findPackages(dir) {
  const packages = {};
  await Promise.all(
    Object.entries(registries).map(async ([registry, { name: readName, version, url }]) => {
      const name = readName(dir);
      if (!name) return;
      const published = await version(name);
      if (published) packages[registry] = { name, version: published, url: url(name) };
    }),
  );
  return packages;
}

async function isOnGitHub(repository) {
  const match = repository?.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) return false;
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const repo = await fetchJson(
    `https://api.github.com/repos/${match[1]}/${match[2]}`,
    token ? { Authorization: `Bearer ${token}` } : {},
  );
  return Boolean(repo && !repo.private && !repo.archived);
}

// fumablox always links to /docs/api, since it expects to own the whole docs folder.
function rewriteLinks(dir, slug) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.mdx')) continue;
    const file = path.join(entry.parentPath, entry.name);
    const content = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, content.replaceAll('/docs/api/', `/docs/${slug}/`).replaceAll('(/docs/api)', `(/docs/${slug})`));
  }
}

const yamlString = (value) => JSON.stringify(value ?? '');

function overviewPage({ title, description, slug, repository, packages }) {
  const published = Object.keys(packages);
  const alias = title.replace(/[^A-Za-z0-9_]/g, '');
  const lines = [
    '---',
    'title: Overview',
    `description: ${yamlString(description)}`,
    '---',
    '',
    '{/* @generated by scripts/generate.mjs. Do not edit this file. */}',
    '',
  ];

  if (published.length > 0) {
    lines.push(
      '## Installing',
      '',
      `<Tabs items={${JSON.stringify(published)}}>`,
      ...published.flatMap((registry) => {
        const { name, version } = packages[registry];
        return [
          `  <Tab value="${registry}">`,
          '',
          `\`\`\`toml title="${registry}.toml"`,
          '[dependencies]',
          registries[registry].dependency(alias, name, version),
          '```',
          '',
          '  </Tab>',
        ];
      }),
      '</Tabs>',
      '',
    );
  } else {
    lines.push(
      '<Callout>This library is not on a package registry yet. Use it from its GitHub repository for now.</Callout>',
      '',
    );
  }

  lines.push(
    '## Usage',
    '',
    '```lua',
    `local ${alias} = require(path.to.${alias})`,
    '```',
    '',
    `See the [API reference](/docs/${slug}/api) for everything it exposes.`,
    '',
  );

  if (repository || published.length > 0) {
    lines.push('## Links', '');
    if (repository) lines.push(`- [Source on GitHub](${repository})`);
    for (const registry of published) {
      const { name, version, url } = packages[registry];
      lines.push(`- [\`${name}@${version}\` on ${registry}](${url})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

const libraries = fs
  .readdirSync(librariesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(librariesDir, entry.name))
  .filter((dir) => fs.existsSync(path.join(dir, 'fumablox.toml')))
  .sort();

const list = [];

for (const dir of libraries) {
  const config = parse(fs.readFileSync(path.join(dir, 'fumablox.toml'), 'utf8'));
  const title = config.title ?? path.basename(dir);
  const slug = slugify(path.basename(dir));

  if (!includeUnpublished && !(await isOnGitHub(config.gitRepoUrl))) {
    console.log(`- ${title}: ${config.gitRepoUrl ?? 'no gitRepoUrl'} is not a public GitHub repository, skipped`);
    continue;
  }

  const packages = await findPackages(dir);

  const out = path.join(outRoot, slug);
  console.log(`> ${title} -> ${path.relative(process.cwd(), out)}`);
  // Run from the library so source links are relative to its repo root.
  execFileSync(process.execPath, [fumablox, 'generate', '--config', 'fumablox.toml', '--out', out], {
    cwd: dir,
    stdio: 'inherit',
  });
  rewriteLinks(out, slug);

  // fumablox's index becomes the API reference; the library's index is its overview.
  const apiIndex = path.join(out, 'index.mdx');
  if (fs.existsSync(apiIndex)) fs.renameSync(apiIndex, path.join(out, 'api.mdx'));

  const library = {
    title,
    slug,
    description: config.description ?? '',
    repository: config.gitRepoUrl,
    packages,
  };
  fs.writeFileSync(path.join(out, 'index.mdx'), overviewPage(library));

  const metaPath = path.join(out, 'meta.json');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
  // Overview and API reference first, then the classes, then fumablox's extra pages.
  const extras = ['graph', 'architecture', 'dependencies', 'changelog'];
  const pages = (meta.pages ?? []).filter((page) => page !== 'index' && page !== 'api');
  const ordered = [...pages.filter((page) => !extras.includes(page)), ...pages.filter((page) => extras.includes(page))];
  fs.writeFileSync(metaPath, JSON.stringify({ ...meta, title, pages: ['index', 'api', ...ordered] }, null, 2) + '\n');

  list.push(library);
}

fs.writeFileSync(
  path.join(outRoot, 'meta.json'),
  JSON.stringify({ title: 'Libraries', pages: list.map((library) => library.slug) }, null, 2) + '\n',
);
fs.writeFileSync(listPath, JSON.stringify(list, null, 2) + '\n');

if (list.length === 0) {
  console.warn(`! no library on GitHub with a fumablox.toml in ${librariesDir}`);
}
