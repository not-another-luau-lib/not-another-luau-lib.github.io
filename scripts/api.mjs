// Writes Moonwave-style API pages from fumablox's extract (see `fumablox extract`), one per source
// file and laid out like the source tree, rendered with the components in components/api.tsx.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Not exported by the package, so imported by path, like the CLI in generate.mjs.
const { resolveLink, rewriteShortLinks } = await import(
  pathToFileURL(path.resolve(import.meta.dirname, '../node_modules/@metricsrb/fumablox/dist/extract/links.js')).href
);

const admonitions = {
  tip: ['success', 'Tip'],
  note: ['info', 'Note'],
  info: ['info', 'Info'],
  caution: ['warn', 'Caution'],
  warning: ['warn', 'Warning'],
  danger: ['error', 'Danger'],
};

const attr = (value) => `{${JSON.stringify(value)}}`;

// Escapes what MDX would parse as JSX outside of code, and turns Moonwave's
// `:::tip Title` ... `:::` admonitions into callouts.
function markdown(text, ctx) {
  if (!text) return '';
  const escaped = rewriteShortLinks(text, ctx)
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/[{}<]/g, (c) => `\\${c}`)))
    .join('');

  return escaped
    .split('\n')
    .map((line) => {
      const open = line.match(/^:::\s*(\w+)\s*(.*)$/);
      if (open && admonitions[open[1].toLowerCase()]) {
        const [type, title] = admonitions[open[1].toLowerCase()];
        return `<Callout type="${type}" title=${attr(open[2].trim() || title)}>\n`;
      }
      return line.trim() === ':::' ? '\n</Callout>' : line;
    })
    .join('\n');
}

// First paragraph as plain text, for the page description.
function summary(text) {
  const first = (text ?? '').split(/\n\s*\n/)[0] ?? '';
  if (first.startsWith('```') || first.startsWith(':::')) return '';
  return first
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function rest(text) {
  const paragraphs = (text ?? '').split(/\n\s*\n/);
  return summary(text) ? paragraphs.slice(1).join('\n\n') : text ?? '';
}

function linksFor(ctx, ...types) {
  const links = {};
  for (const type of types) {
    for (const [ident] of (type ?? '').matchAll(/[A-Za-z_][\w]*/g)) {
      const href = resolveLink(ident, ctx);
      if (href) links[ident] = href;
    }
  }
  return links;
}

function badges(meta, extra = []) {
  const items = [...extra];
  for (const realm of meta.realms ?? []) {
    items.push({ label: realm[0].toUpperCase() + realm.slice(1), variant: realm });
  }
  if (meta.deprecated) items.push({ label: 'Deprecated', variant: 'deprecated' });
  if (meta.unreleased) items.push({ label: 'Unreleased', variant: 'unreleased' });
  if (meta.since) items.push({ label: `since ${meta.since}` });
  for (const tag of meta.tags ?? []) items.push({ label: tag });
  return items;
}

function badgeLine(meta, config, extra) {
  const items = badges(meta, extra);
  const source = sourceUrl(meta.source, config);
  if (items.length === 0 && !source) return [];
  return [`<Badges items=${attr(items)}${source ? ` source=${attr(source)}` : ''} />`, ''];
}

function sourceUrl(source, config) {
  if (!source || !config.gitRepoUrl) return undefined;
  const repo = config.gitRepoUrl.replace(/\.git$/, '').replace(/\/$/, '');
  return `${repo}/blob/${config.gitSourceBranch ?? 'main'}/${source.path}#L${source.line}`;
}

function deprecation(meta, ctx) {
  if (!meta.deprecated) return [];
  return [
    `<Callout type="warn" title=${attr(`Deprecated in ${meta.deprecated.version}`)}>`,
    '',
    markdown(meta.deprecated.description, ctx) || 'This is deprecated.',
    '',
    '</Callout>',
    '',
  ];
}

const cell = (text, ctx) => markdown(text, ctx).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

function table(title, rows, ctx) {
  if (rows.length === 0) return [];
  const withNames = rows.some((row) => row.name !== undefined);
  const header = withNames ? '| Name | Type | Description |\n| --- | --- | --- |' : '| Type | Description |\n| --- | --- |';
  return [
    `**${title}**`,
    '',
    header,
    ...rows.map((row) => {
      const type = row.type ? `<TypeCode type=${attr(row.type)} links=${attr(linksFor(ctx, row.type))} />` : '';
      const cells = [type, cell(row.description, ctx)];
      if (withNames) cells.unshift(`\`${row.name}${row.optional ? '?' : ''}\``);
      return `| ${cells.join(' | ')} |`;
    }),
    '',
  ];
}

const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
const visible = (member) => !member.private && !member.ignore;

// Heading levels and anchor ids: a page with several classes nests each one a level deeper
// and prefixes its anchors with the class name.
const layout = (cls, nested) => ({
  section: nested ? '###' : '##',
  member: nested ? '####' : '###',
  id: (name) => (nested ? `${cls.name}-${name}` : name),
});

function typeSection(cls, ctx, config, h) {
  const types = cls.types.filter(visible).sort(byName);
  if (types.length === 0) return [];
  return [
    `${h.section} Types`,
    '',
    ...types.flatMap((type) => [
      `${h.member} ${type.name} [#${h.id(type.name)}]`,
      '',
      ...badgeLine(type, config),
      ...deprecation(type, ctx),
      ...(type.luaType
        ? [`<Signature kind="type" name=${attr(type.name)} type=${attr(type.luaType)} links=${attr(linksFor(ctx, type.luaType))} />`, '']
        : []),
      markdown(type.description, ctx),
      '',
      ...table(
        'Fields',
        type.fields.map((field) => ({ name: field.name, type: field.luaType, description: field.description })),
        ctx,
      ),
    ]),
  ];
}

function valueSection(title, members, cls, ctx, config, h) {
  const list = members.filter(visible).sort(byName);
  if (list.length === 0) return [];
  return [
    `${h.section} ${title}`,
    '',
    ...list.flatMap((member) => [
      `${h.member} ${member.name} [#${h.id(member.name)}]`,
      '',
      ...badgeLine(member, config, member.readonly ? [{ label: 'Read only' }] : []),
      ...deprecation(member, ctx),
      `<Signature kind="value" owner=${attr(cls.name)} name=${attr(member.name)} type=${attr(member.luaType ?? member.value ?? 'any')} links=${attr(linksFor(ctx, member.luaType))} />`,
      '',
      markdown(member.description, ctx),
      '',
    ]),
  ];
}

function enumSection(cls, ctx, config, h) {
  const enums = cls.enums.filter(visible).sort(byName);
  if (enums.length === 0) return [];
  return [
    `${h.section} Enums`,
    '',
    ...enums.flatMap((item) => [
      `${h.member} ${item.name} [#${h.id(item.name)}]`,
      '',
      ...badgeLine(item, config),
      markdown(item.description, ctx),
      '',
      '| Item | Value | Description |',
      '| --- | --- | --- |',
      ...item.items.map((entry) => `| \`${entry.name}\` | \`${entry.value}\` | ${cell(entry.description, ctx)} |`),
      '',
    ]),
  ];
}

function functionSection(cls, ctx, config, h) {
  const functions = cls.functions.filter(visible);
  // Static functions first, then methods, like Moonwave.
  const sorted = [
    ...functions.filter((fn) => fn.functionKind !== 'method').sort(byName),
    ...functions.filter((fn) => fn.functionKind === 'method').sort(byName),
  ];
  if (sorted.length === 0) return [];

  return [
    `${h.section} Functions`,
    '',
    ...sorted.flatMap((fn) => {
      const separator = fn.functionKind === 'method' ? ':' : '.';
      const types = [...fn.params.map((p) => p.luaType), ...fn.returns.map((r) => r.luaType)];
      const extra = [];
      if (fn.functionKind === 'method') extra.push({ label: 'Method' });
      if (fn.yields) extra.push({ label: 'Yields', variant: 'yields' });

      return [
        `${h.member} ${separator}${fn.name} [#${h.id(fn.name)}]`,
        '',
        ...badgeLine(fn, config, extra),
        ...deprecation(fn, ctx),
        `<Signature owner=${attr(cls.name)} separator="${separator}" name=${attr(fn.name)} params=${attr(
          fn.params.map((p) => ({ name: p.optional ? `${p.name}?` : p.name, type: p.luaType })),
        )} returns=${attr(fn.returns.map((r) => r.luaType))} links=${attr(linksFor(ctx, ...types))} />`,
        '',
        markdown(fn.description, ctx),
        '',
        ...(fn.params.some((p) => p.description)
          ? table(
              'Parameters',
              fn.params.map((p) => ({ name: p.name, type: p.luaType, description: p.description, optional: p.optional })),
              ctx,
            )
          : []),
        ...(fn.returns.some((r) => r.description)
          ? table('Returns', fn.returns.map((r) => ({ type: r.luaType, description: r.description })), ctx)
          : []),
        ...table('Errors', fn.errors.map((e) => ({ type: e.luaType, description: e.description })), ctx),
        ...fn.examples.flatMap((example) => [
          `\`\`\`${example.language || 'lua'}${example.title ? ` title=${JSON.stringify(example.title)}` : ''}`,
          example.code,
          '```',
          '',
        ]),
      ];
    }),
  ];
}

function classBody(cls, ctx, config, nested) {
  const h = layout(cls, nested);
  const intro = nested
    ? [`## ${cls.name} [#${cls.name}]`, '', ...badgeLine(cls, config), markdown(cls.description, ctx)]
    : [...badgeLine(cls, config), markdown(rest(cls.description), ctx)];
  return [
    ...intro,
    '',
    ...deprecation(cls, ctx),
    ...typeSection(cls, ctx, config, h),
    ...valueSection('Properties', cls.properties, cls, ctx, config, h),
    ...valueSection('Events', cls.events, cls, ctx, config, h),
    ...valueSection('Constants', cls.constants, cls, ctx, config, h),
    ...enumSection(cls, ctx, config, h),
    ...functionSection(cls, ctx, config, h),
  ];
}

function filePage(title, classes, ctx, config, intro) {
  const nested = classes.length > 1;
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(summary(classes[0].description))}`,
    '---',
    '',
    '{/* @generated by scripts/generate.mjs from fumablox. Do not edit this file. */}',
    '',
    ...intro,
    ...classes.flatMap((cls) => classBody(cls, ctx, config, nested)),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

const isInit = (name) => /^init\.luau?$/.test(name);
const stem = (name) => name.replace(/\.luau?$/, '');
const byKey = ([a], [b]) => a.localeCompare(b);

// Source files as Rojo sees them: a folder with an init.luau is that module, and the other
// files next to it are its children.
function buildTree(paths) {
  const root = { dirs: new Map(), files: new Map() };
  for (const rel of paths) {
    const parts = rel.split('/');
    const name = parts.pop();
    let node = root;
    for (const part of parts) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: new Map() });
      node = node.dirs.get(part);
    }
    if (isInit(name)) node.init = rel;
    else node.files.set(name, rel);
  }
  return root;
}

function writeMeta(dir, meta) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
}

// Lays a tree node out as Fumadocs pages and folders inside `dir`, writing each folder's
// meta.json. A folder's index.mdx is its own module, so clicking the folder opens it.
// Collects every page as { rel, file, title } and returns the parent's entries.
function layoutChildren(node, dir, pages) {
  const entries = [];
  for (const [name, rel] of [...node.files].sort(byKey)) {
    pages.push({ rel, file: path.join(dir, `${stem(name)}.mdx`), title: name });
    entries.push(stem(name));
  }
  for (const [name, child] of [...node.dirs].sort(byKey)) {
    const into = path.join(dir, name);
    if (child.init) pages.push({ rel: child.init, file: path.join(into, 'index.mdx'), title: name });
    const children = layoutChildren(child, into, pages);
    writeMeta(into, { title: name, pages: children });
    entries.push(name);
  }
  return entries;
}

// The library root: its init.luau comes first and everything else nests under it.
function layoutRoot(root, out, pages) {
  if (!root.init) return layoutChildren(root, out, pages);
  const title = path.basename(root.init);
  if (root.files.size + root.dirs.size === 0) {
    pages.push({ rel: root.init, file: path.join(out, 'init.mdx'), title });
    return ['init'];
  }
  const into = path.join(out, 'init');
  pages.push({ rel: root.init, file: path.join(into, 'index.mdx'), title });
  writeMeta(into, { title, pages: layoutChildren(root, into, pages), defaultOpen: true });
  return ['init'];
}

const urlOf = (file, out, baseUrl) =>
  [baseUrl, ...path.relative(out, file).replace(/\.mdx$/, '').split(path.sep).filter((s) => s !== 'index')].join('/');

// Placeholder base url for fumablox's resolver: links come back as `@@/Class#member` and are
// pointed at the page of the file declaring the class once every page is laid out.
const LINK_BASE = '@@';

// Writes one page per documented source file into `out`, laid out like the source tree.
// `intro` goes at the top of the first page. Returns the entries of the library's
// meta.json and the url of its first page.
export function writeApiPages(extract, config, out, baseUrl, intro = []) {
  const classes = extract.classes.filter(visible).sort(byName);
  const typeNames = new Map();
  const externals = {};
  for (const cls of classes) {
    for (const type of cls.types) typeNames.set(type.name, cls.name);
    Object.assign(externals, cls.externals);
  }
  for (const pkg of extract.wally?.packages ?? []) externals[pkg.alias] = pkg.documentationUrl;

  const ctx = {
    classNames: new Set(classes.map((cls) => cls.name)),
    typeNames,
    memberAnchors: new Map(),
    externals,
    baseUrl: LINK_BASE,
    robloxLinks: config.robloxLinks ?? true,
  };

  // Classes grouped by source file, relative to the code folder they live in.
  const codeDirs = [config.code ?? 'src'].flat().map((dir) => dir.replace(/^\.\//, '').replace(/\/$/, ''));
  const byFile = new Map();
  for (const cls of classes) {
    const file = cls.source.path.replaceAll('\\', '/');
    const dir = codeDirs.find((d) => file.startsWith(`${d}/`));
    const rel = dir ? file.slice(dir.length + 1) : file;
    if (!byFile.has(rel)) byFile.set(rel, []);
    byFile.get(rel).push(cls);
  }

  fs.mkdirSync(out, { recursive: true });
  const pages = [];
  const entries = layoutRoot(buildTree([...byFile.keys()]), out, pages);

  const targets = new Map();
  for (const page of pages) {
    const pageClasses = byFile.get(page.rel);
    for (const cls of pageClasses) {
      targets.set(cls.name, { url: urlOf(page.file, out, baseUrl), nested: pageClasses.length > 1 });
    }
  }
  const resolve = (text) =>
    text.replace(/@@\/([A-Za-z_]\w*)(?:#([\w.]+))?/g, (match, name, member) => {
      const target = targets.get(name);
      if (!target) return match;
      if (member) return `${target.url}#${target.nested ? `${name}-${member}` : member}`;
      return target.nested ? `${target.url}#${name}` : target.url;
    });

  pages.forEach((page, i) => {
    fs.mkdirSync(path.dirname(page.file), { recursive: true });
    const content = filePage(page.title, byFile.get(page.rel), ctx, config, i === 0 ? intro : []);
    fs.writeFileSync(page.file, resolve(content));
  });

  return { entries, href: pages[0] ? urlOf(pages[0].file, out, baseUrl) : baseUrl };
}
