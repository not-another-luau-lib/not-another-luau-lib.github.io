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
      const cells = [type, cell(row.description, ctx) || '—'];
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

// Everything below a function's heading: badges, signature, the description's first paragraph,
// its parameters, return values and errors, then the rest of the description and examples. `callee` is how it is called: `Class.name`, `Class:name`,
// or just `Class` when requiring the module returns the function itself.
function functionBody(fn, callee, ctx, config) {
  const types = [...fn.params.map((p) => p.luaType), ...fn.returns.map((r) => r.luaType)];
  const extra = fn.yields ? [{ label: 'Yields', variant: 'yields' }] : [];

  return [
    ...badgeLine(fn, config, extra),
    ...deprecation(fn, ctx),
    `<Signature${callee.owner ? ` owner=${attr(callee.owner)} separator="${callee.separator}"` : ''} name=${attr(callee.name)} params=${attr(
      fn.params.map((p) => ({ name: p.optional ? `${p.name}?` : p.name, type: p.luaType })),
    )} returns=${attr(fn.returns.map((r) => r.luaType))} links=${attr(linksFor(ctx, ...types))} />`,
    '',
    summary(fn.description) ? markdown(fn.description.split(/\n\s*\n/)[0], ctx) : '',
    '',
    ...table(
      'Parameters',
      fn.params.map((p) => ({ name: p.name, type: p.luaType ?? 'any', description: p.description, optional: p.optional })),
      ctx,
    ),
    ...table('Return values', fn.returns.map((r) => ({ type: r.luaType, description: r.description })), ctx),
    ...table('Errors', fn.errors.map((e) => ({ type: e.luaType, description: e.description })), ctx),
    markdown(rest(fn.description), ctx),
    '',
    ...fn.examples.flatMap((example) => [
      `\`\`\`${example.language || 'lua'}${example.title ? ` title=${JSON.stringify(example.title)}` : ''}`,
      example.code,
      '```',
      '',
    ]),
  ];
}

// The function `require` gives back, for a module that returns a function instead of a table.
// It may be documented as a @function or as a @type; for a type, the parameters and return
// values come from the function in the source.
function returnsSection(items, cls, ctx, config, h) {
  if (items.length === 0) return [];
  return [
    `${h.section} Returns [#${h.id('returns')}]`,
    '',
    `Requiring this module returns a function: call \`${cls.name}(...)\` directly.`,
    '',
    ...items.flatMap((item) => {
      const signature = ctx.returned.get(item);
      const fn = item.kind === 'function' ? item : { ...item, yields: false, errors: [], examples: [], ...signature };
      return functionBody(fn, { name: cls.name }, ctx, config);
    }),
  ];
}

function functionSection(title, fns, cls, ctx, config, h) {
  if (fns.length === 0) return [];
  return [
    `${h.section} ${title}`,
    '',
    ...fns.sort(byName).flatMap((fn) => {
      const separator = fn.functionKind === 'method' ? ':' : '.';
      return [
        `${h.member} ${separator}${fn.name} [#${h.id(fn.name)}]`,
        '',
        ...functionBody(fn, { owner: cls.name, separator, name: fn.name }, ctx, config),
      ];
    }),
  ];
}

function classBody(cls, ctx, config, nested, after = []) {
  const h = layout(cls, nested);
  const intro = nested
    ? [`## ${cls.name} [#${cls.name}]`, '', ...badgeLine(cls, config), markdown(cls.description, ctx)]
    : [...badgeLine(cls, config), markdown(rest(cls.description), ctx)];
  const functions = cls.functions.filter(visible);
  const returned = [...functions, ...cls.types.filter(visible)].filter((item) => ctx.returned.has(item));
  const others = functions.filter((fn) => !ctx.returned.has(fn));

  return [
    ...intro,
    '',
    ...deprecation(cls, ctx),
    ...after,
    ...returnsSection(returned, cls, ctx, config, h),
    ...typeSection(cls, ctx, config, h),
    ...valueSection('Properties', cls.properties, cls, ctx, config, h),
    ...valueSection('Events', cls.events, cls, ctx, config, h),
    ...valueSection('Constants', cls.constants, cls, ctx, config, h),
    ...enumSection(cls, ctx, config, h),
    ...functionSection('Functions', others.filter((fn) => fn.functionKind !== 'method'), cls, ctx, config, h),
    ...functionSection('Methods', others.filter((fn) => fn.functionKind === 'method'), cls, ctx, config, h),
  ];
}

function filePage(title, classes, ctx, config, intro, outro) {
  const nested = classes.length > 1;
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(summary(classes[0].description))}`,
    '---',
    '',
    '{/* @generated by scripts/generate.mjs from fumablox. Do not edit this file. */}',
    '',
    // A single class describes the module, so the intro follows its description.
    ...(nested ? intro : []),
    ...classes.flatMap((cls) => classBody(cls, ctx, config, nested, nested ? [] : intro)),
    ...outro,
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

const isLeaf = (node) => node.files.size + node.dirs.size === 0;

function writeMeta(dir, meta) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
}

// Lays the modules of a tree node out inside `dir`, each named like its Rojo instance. A
// folder module with children becomes a Fumadocs folder whose index.mdx is the module itself,
// so clicking the folder opens it; one without children is a plain page. Collects every page
// as { rel, file, title } and returns the entries for the parent's meta.json.
function layoutChildren(node, dir, pages) {
  const entries = [];
  for (const [name, rel] of [...node.files].sort(byKey)) {
    pages.push({ rel, file: path.join(dir, `${stem(name)}.mdx`), title: stem(name) });
    entries.push(stem(name));
  }
  for (const [name, child] of [...node.dirs].sort(byKey)) {
    if (child.init && isLeaf(child)) {
      pages.push({ rel: child.init, file: path.join(dir, `${name}.mdx`), title: name });
    } else {
      const into = path.join(dir, name);
      if (child.init) pages.push({ rel: child.init, file: path.join(into, 'index.mdx'), title: name });
      writeMeta(into, { title: name, pages: layoutChildren(child, into, pages) });
    }
    entries.push(name);
  }
  return entries;
}

// The library itself: a single module is one page named after the library. Otherwise it is a
// folder listing its modules, with the root init.luau first under the library's name.
function layoutLibrary(root, outRoot, slug, title, pages) {
  if (root.init && isLeaf(root)) {
    pages.push({ rel: root.init, file: path.join(outRoot, `${slug}.mdx`), title });
    return;
  }
  if (!root.init && root.dirs.size === 0 && root.files.size === 1) {
    const [rel] = root.files.values();
    pages.push({ rel, file: path.join(outRoot, `${slug}.mdx`), title });
    return;
  }

  const dir = path.join(outRoot, slug);
  const entries = [];
  if (root.init) {
    pages.push({ rel: root.init, file: path.join(dir, 'index.mdx'), title });
    entries.push('index');
  }
  writeMeta(dir, { title, pages: [...entries, ...layoutChildren(root, dir, pages)] });
}

const urlOf = (file, outRoot) =>
  ['/docs', ...path.relative(outRoot, file).replace(/\.mdx$/, '').split(path.sep).filter((s) => s !== 'index')].join('/');

// Splits `a, b: (x, y) -> z` on the commas that are not nested in brackets. The `>` of `->`
// is not a closing bracket.
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('([{<'.includes(c)) depth++;
    else if (')]}'.includes(c) || (c === '>' && text[i - 1] !== '-')) depth--;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

// Parameters and return values of a one-line function definition such as
// `return function<T...>(callback: (T...) -> (), ...: T...): thread`.
function parseSignature(line) {
  const open = line.match(/function\s*[\w.:]*\s*(?:<[^()]*>)?\s*\(/);
  if (!open) return undefined;
  let depth = 0;
  let close = open.index + open[0].length;
  for (; close < line.length; close++) {
    const c = line[close];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) break;
      depth--;
    }
  }
  const params = splitTopLevel(line.slice(open.index + open[0].length, close)).map((param) => {
    const colon = param.indexOf(':');
    return colon === -1
      ? { name: param, description: '' }
      : { name: param.slice(0, colon).trim(), luaType: param.slice(colon + 1).trim(), description: '' };
  });
  const ret = line.slice(close + 1).match(/^\s*:\s*(.+?)\s*(?:--.*)?$/)?.[1];
  return { params, returns: ret ? [{ luaType: ret, description: '' }] : [] };
}

// Doc entries (functions or types) that describe the module's return value: their comment is
// followed by `return function(...)`, or by `local function name` with the file ending in
// `return name`. Maps each one to the signature read from that function.
function moduleReturns(classes, dir) {
  const returned = new Map();
  const files = new Map();
  const lines = (file) => {
    if (!files.has(file)) {
      const full = path.join(dir ?? '', file);
      files.set(file, dir && fs.existsSync(full) ? fs.readFileSync(full, 'utf8').split(/\r?\n/) : []);
    }
    return files.get(file);
  };
  for (const cls of classes) {
    for (const item of [...cls.functions, ...cls.types]) {
      const source = lines(item.source.path);
      const next = source.slice(item.source.endLine).find((line) => line.trim() !== '')?.trim() ?? '';
      const last = source.findLast((line) => line.trim() !== '')?.trim() ?? '';
      const local = next.match(/^(?:local\s+)?function\s+([A-Za-z_]\w*)\s*[<(]/);
      if (/^return\s+function\b/.test(next) || (local && last === `return ${local[1]}`)) {
        returned.set(item, parseSignature(next) ?? { params: [], returns: [] });
      }
    }
  }
  return returned;
}

// Placeholder base url for fumablox's resolver: links come back as `@@/Class#member` and are
// pointed at the page of the file declaring the class once every page is laid out.
const LINK_BASE = '@@';

// Writes one page per documented source file of a library under `outRoot` (served at /docs),
// laid out like its source tree. `intro` and `outro` go at the top and bottom of its first
// page. Returns the url of that page.
export function writeApiPages(extract, config, { dir, outRoot, slug, title, intro = [], outro = [] }) {
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
    returned: moduleReturns(classes, dir),
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

  const pages = [];
  layoutLibrary(buildTree([...byFile.keys()]), outRoot, slug, title, pages);

  const targets = new Map();
  for (const page of pages) {
    const pageClasses = byFile.get(page.rel);
    for (const cls of pageClasses) {
      targets.set(cls.name, { url: urlOf(page.file, outRoot), nested: pageClasses.length > 1 });
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
    const content = filePage(page.title, byFile.get(page.rel), ctx, config, i === 0 ? intro : [], i === 0 ? outro : []);
    fs.writeFileSync(page.file, resolve(content));
  });

  return pages[0] ? urlOf(pages[0].file, outRoot) : `/docs/${slug}`;
}
