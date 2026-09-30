// Writes one Moonwave-style API page per class from fumablox's extract (see `fumablox extract`),
// rendered with the components in components/api.tsx.

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

function typeSection(cls, ctx, config) {
  const types = cls.types.filter(visible).sort(byName);
  if (types.length === 0) return [];
  return [
    '## Types',
    '',
    ...types.flatMap((type) => [
      `### ${type.name} [#${type.name}]`,
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

function valueSection(title, members, cls, ctx, config) {
  const list = members.filter(visible).sort(byName);
  if (list.length === 0) return [];
  return [
    `## ${title}`,
    '',
    ...list.flatMap((member) => [
      `### ${member.name} [#${member.name}]`,
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

function enumSection(cls, ctx, config) {
  const enums = cls.enums.filter(visible).sort(byName);
  if (enums.length === 0) return [];
  return [
    '## Enums',
    '',
    ...enums.flatMap((item) => [
      `### ${item.name} [#${item.name}]`,
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

function functionSection(cls, ctx, config) {
  const functions = cls.functions.filter(visible);
  // Static functions first, then methods, like Moonwave.
  const sorted = [
    ...functions.filter((fn) => fn.functionKind !== 'method').sort(byName),
    ...functions.filter((fn) => fn.functionKind === 'method').sort(byName),
  ];
  if (sorted.length === 0) return [];

  return [
    '## Functions',
    '',
    ...sorted.flatMap((fn) => {
      const separator = fn.functionKind === 'method' ? ':' : '.';
      const types = [...fn.params.map((p) => p.luaType), ...fn.returns.map((r) => r.luaType)];
      const extra = [];
      if (fn.functionKind === 'method') extra.push({ label: 'Method' });
      if (fn.yields) extra.push({ label: 'Yields', variant: 'yields' });

      return [
        `### ${separator}${fn.name} [#${fn.name}]`,
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

function classPage(cls, ctx, config) {
  return [
    '---',
    `title: ${JSON.stringify(cls.name)}`,
    `description: ${JSON.stringify(summary(cls.description))}`,
    '---',
    '',
    '{/* @generated by scripts/generate.mjs from fumablox. Do not edit this file. */}',
    '',
    ...badgeLine(cls, config),
    ...deprecation(cls, ctx),
    markdown(rest(cls.description), ctx),
    '',
    ...typeSection(cls, ctx, config),
    ...valueSection('Properties', cls.properties, cls, ctx, config),
    ...valueSection('Events', cls.events, cls, ctx, config),
    ...valueSection('Constants', cls.constants, cls, ctx, config),
    ...enumSection(cls, ctx, config),
    ...functionSection(cls, ctx, config),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

// Returns the documented classes, as { name, description }, in sidebar order.
export function writeApiPages(extract, config, out, baseUrl) {
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
    baseUrl,
    robloxLinks: config.robloxLinks ?? true,
  };

  fs.mkdirSync(out, { recursive: true });
  for (const cls of classes) {
    fs.writeFileSync(path.join(out, `${cls.name}.mdx`), classPage(cls, ctx, config));
  }
  return classes.map((cls) => ({ name: cls.name, description: summary(cls.description) }));
}
