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
import os from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { writeApiPages } from './api.mjs';

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

// Each registry: the package as the library's manifest declares it, and how to find the latest
// version published.
const registries = {
  wally: {
    manifest: (dir) => readToml(path.join(dir, 'wally.toml'))?.package,
    version: async (name) => {
      const data = await fetchJson(`https://api.wally.run/v1/package-metadata/${name}`);
      return latest((data?.versions ?? []).map((v) => v.package?.version));
    },
    url: (name) => `https://wally.run/package/${name}`,
    dependency: (alias, name, version) => `${alias} = "${name}@^${version}"`,
  },
  pesde: {
    manifest: (dir) => readToml(path.join(dir, 'pesde.toml')),
    version: async (name) => {
      const data = await fetchJson(`https://registry.pesde.dev/v1/packages/${encodeURIComponent(name)}`);
      return latest(Object.keys(data?.versions ?? {}));
    },
    url: (name) => `https://pesde.dev/packages/${name}`,
    dependency: (alias, name, version) => `${alias} = { name = "${name}", version = "^${version}" }`,
  },
  ember: {
    manifest: (dir) => readToml(path.join(dir, 'ember.toml'))?.package,
    version: async (name) => {
      const data = await fetchJson(`https://api.luaupm.com/v1/packages/${name}`);
      return latest(Object.values(data?.versions ?? {}).map((v) => v.version));
    },
    url: (name) => `https://luaupm.com/package?name=${encodeURIComponent(name)}`,
    dependency: (alias, name, version) => `${alias} = { name = "${name}", version = "^${version}" }`,
  },
};

// Every registry the library has a manifest for, with the latest published version when there
// is one (`published`) and the manifest's version otherwise.
async function findPackages(dir) {
  const packages = {};
  for (const [registry, { manifest, version, url }] of Object.entries(registries)) {
    const { name, version: declared } = manifest(dir) ?? {};
    if (!name) continue;
    const published = await version(name);
    packages[registry] = { name, version: published ?? declared, published: Boolean(published), url: url(name) };
  }
  return packages;
}

const githubToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
const githubApi = (route) =>
  fetchJson(`https://api.github.com/${route}`, githubToken ? { Authorization: `Bearer ${githubToken}` } : {});
const repoPath = (repository) => repository?.match(/github\.com\/([^/]+\/[^/.]+)/)?.[1];

async function isOnGitHub(repository) {
  const repo = repoPath(repository) && (await githubApi(`repos/${repoPath(repository)}`));
  return Boolean(repo && !repo.private && !repo.archived);
}

// The library's examples/*.luau, at the bottom of its first page. The comment at the top of
// each file becomes its description; `--!` directives are left out.
function examples(dir) {
  const folder = path.join(dir, 'examples');
  if (!fs.existsSync(folder)) return [];
  const files = fs
    .readdirSync(folder)
    .filter((file) => /\.luau?$/.test(file))
    .sort();
  if (files.length === 0) return [];

  return [
    '## Examples',
    '',
    ...files.flatMap((file) => {
      const lines = fs.readFileSync(path.join(folder, file), 'utf8').split(/\r?\n/);
      let start = 0;
      while (start < lines.length && lines[start].startsWith('--!')) start++;
      const comment = [];
      while (start < lines.length && /^--(?!\[)/.test(lines[start])) comment.push(lines[start++].replace(/^--\s?/, ''));
      while (start < lines.length && lines[start].trim() === '') start++;
      const code = lines.slice(start).join('\n').trimEnd();
      const description = comment.join(' ').trim().replace(/[{}<]/g, (c) => `\\${c}`);

      return [
        `### ${file.replace(/\.luau?$/, '')}`,
        '',
        ...(description ? [description, ''] : []),
        `\`\`\`lua title=${JSON.stringify(file)}`,
        code,
        '```',
        '',
      ];
    }),
  ];
}

// The top of a library's first page: its GitHub repository, then how to install it with each
// package manager or as a model file from its releases.
function installIntro(title, repository, packages) {
  const alias = title.replace(/[^A-Za-z0-9_]/g, '');
  const tabs = [
    ...Object.entries(packages).map(([registry, { name, version, published, url }]) => [
      registry,
      [
        `\`\`\`toml title="${registry}.toml"`,
        '[dependencies]',
        registries[registry].dependency(alias, name, version),
        '```',
        '',
        published ? `[\`${name}@${version}\` on ${registry}](${url})` : `Not published to ${registry} yet.`,
      ],
    ]),
    ...(repoPath(repository)
      ? [['native', [`Install from the [Releases page](https://github.com/${repoPath(repository)}/releases).`]]]
      : []),
  ];

  return [
    '## Installation',
    '',
    ...(repository ? [`<RepoLink href=${JSON.stringify(repository)} />`, ''] : []),
    ...(tabs.length > 0
      ? [
          `<Tabs items={${JSON.stringify(tabs.map(([name]) => name))}}>`,
          ...tabs.flatMap(([name, body]) => [`  <Tab value="${name}">`, '', ...body, '', '  </Tab>']),
          '</Tabs>',
          '',
        ]
      : []),
  ];
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

  console.log(`> ${title}`);
  // Run from the library so source links are relative to its repo root.
  const extractPath = path.join(os.tmpdir(), `fumablox-${slug}.json`);
  execFileSync(process.execPath, [fumablox, 'extract', '--config', 'fumablox.toml', '--out', extractPath], {
    cwd: dir,
    stdio: 'inherit',
  });
  const extract = JSON.parse(fs.readFileSync(extractPath, 'utf8'));
  fs.rmSync(extractPath, { force: true });
  const intro = installIntro(title, config.gitRepoUrl, packages);
  const href = writeApiPages(extract, config, { dir, outRoot, slug, title, intro, outro: examples(dir) });

  const library = {
    title,
    slug,
    href,
    description: config.description ?? '',
    repository: config.gitRepoUrl,
    packages,
  };

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
