import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

// Components for the API pages that scripts/generate.mjs builds from fumablox's extract.
// Types arrive as plain Luau strings with a `links` map of identifier -> href, resolved at build time.

type Links = Record<string, string>;

const badgeVariants = {
  default: 'border-fd-border text-fd-muted-foreground',
  server: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  client: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  plugin: 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  yields: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  deprecated: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  unreleased: 'border-fd-primary/30 bg-fd-primary/10 text-fd-primary',
};

export type BadgeVariant = keyof typeof badgeVariants;

// Syntax colors for Luau types, in light and dark.
const colors = {
  keyword: 'text-pink-600 dark:text-pink-400',
  primitive: 'text-sky-600 dark:text-sky-400',
  type: 'text-amber-600 dark:text-amber-300',
  generic: 'text-violet-600 dark:text-violet-400',
  field: 'text-orange-600 dark:text-orange-300',
  string: 'text-emerald-600 dark:text-emerald-400',
  func: 'font-semibold text-blue-600 dark:text-blue-400',
  punctuation: 'text-fd-muted-foreground',
};

const primitives = new Set([
  'any', 'boolean', 'buffer', 'false', 'never', 'nil', 'number', 'string',
  'table', 'thread', 'true', 'unknown', 'userdata', 'vector', 'integer',
]);

// Generic parameters: declared in `<...>`, or single capital letters like `T` and `T...`.
function genericsOf(type: string) {
  const names = new Set<string>();
  for (const [, list] of type.matchAll(/<([^<>]*)>\s*\(/g)) {
    for (const name of list.split(',')) names.add(name.replace('...', '').trim());
  }
  return names;
}

function colorOf(ident: string, next: string, generics: Set<string>) {
  if (primitives.has(ident)) return colors.primitive;
  if (ident === 'typeof') return colors.keyword;
  // `name: Type` inside a table or function type.
  if (/^\s*\??\s*:(?!:)/.test(next)) return colors.field;
  if (generics.has(ident) || /^[A-Z]$/.test(ident)) return colors.generic;
  return colors.type;
}

export function ApiType({ type, links = {} }: { type: string; links?: Links }) {
  const generics = genericsOf(type);
  const parts: ReactNode[] = [];
  // Strings, `...`, `->`, identifiers, whitespace, then any other single character.
  for (const match of type.matchAll(/("[^"]*"|'[^']*')|(\.\.\.)|(->)|([A-Za-z_]\w*)|(\s+)|(.)/g)) {
    const [token, str, dots, arrow, ident, space] = match;
    const key = match.index;
    if (space) {
      parts.push(token);
    } else if (str) {
      parts.push(<span key={key} className={colors.string}>{token}</span>);
    } else if (dots || arrow) {
      parts.push(<span key={key} className={colors.punctuation}>{arrow ? '→' : token}</span>);
    } else if (ident) {
      const className = colorOf(ident, type.slice(key + token.length), generics);
      const href = links[ident];
      parts.push(
        href ? (
          <a key={key} href={href} className={cn(className, 'underline decoration-dotted underline-offset-2 hover:decoration-solid')}>
            {token}
          </a>
        ) : (
          <span key={key} className={className}>{token}</span>
        ),
      );
    } else {
      parts.push(<span key={key} className={colors.punctuation}>{token}</span>);
    }
  }
  return <>{parts}</>;
}

export function TypeCode({ type, links }: { type: string; links?: Links }) {
  return (
    <code className="rounded-md border bg-fd-muted px-1.5 py-0.5 text-[0.8125rem]">
      <ApiType type={type} links={links} />
    </code>
  );
}

interface SignatureParam {
  name: string;
  type?: string;
}

function SignatureBlock({ children }: { children: ReactNode }) {
  return (
    <pre className="not-prose my-4 overflow-x-auto rounded-xl border bg-fd-card p-4 font-mono text-[0.8125rem] leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

// `Owner.name(param: Type, ...) → Return`, broken over lines once it gets long, like Moonwave.
// kind="type" renders `type Name = Type`, kind="value" renders `Owner.name: Type`.
export function Signature({
  kind = 'function',
  owner,
  name,
  separator = '.',
  type = 'any',
  params = [],
  returns = [],
  links,
}: {
  kind?: 'function' | 'type' | 'value';
  owner?: string;
  name: string;
  separator?: string;
  type?: string;
  params?: SignatureParam[];
  returns?: string[];
  links?: Links;
}) {
  if (kind === 'type') {
    return (
      <SignatureBlock>
        <span className={colors.keyword}>type </span>
        <span className={cn('font-semibold', colors.type)}>{name}</span>
        <span className={colors.punctuation}> = </span>
        <ApiType type={type} links={links} />
      </SignatureBlock>
    );
  }

  if (kind === 'value') {
    return (
      <SignatureBlock>
        {owner && (
          <>
            <span className={colors.type}>{owner}</span>
            <span className={colors.punctuation}>.</span>
          </>
        )}
        <span className={cn('font-semibold', colors.field)}>{name}</span>
        <span className={colors.punctuation}>: </span>
        <ApiType type={type} links={links} />
      </SignatureBlock>
    );
  }

  const flat = params.map((p) => `${p.name}${p.type ? `: ${p.type}` : ''}`).join(', ');
  const multiline = flat.length + name.length + (owner?.length ?? 0) > 60 && params.length > 1;
  const ret = returns.length === 0 ? '()' : returns.length === 1 ? returns[0] : `(${returns.join(', ')})`;

  return (
    <SignatureBlock>
      {owner && (
        <>
          <span className={colors.type}>{owner}</span>
          <span className={colors.punctuation}>{separator}</span>
        </>
      )}
      <span className={colors.func}>{name}</span>
      <span className={colors.punctuation}>(</span>
      {multiline && '\n'}
      {params.map((param, i) => (
        <Fragment key={param.name + i}>
          {multiline && '    '}
          <span className={colors.field}>{param.name}</span>
          {param.type && (
            <>
              <span className={colors.punctuation}>: </span>
              <ApiType type={param.type} links={links} />
            </>
          )}
          {i < params.length - 1 && <span className={colors.punctuation}>,{multiline ? '' : ' '}</span>}
          {multiline && '\n'}
        </Fragment>
      ))}
      <span className={colors.punctuation}>) → </span>
      <ApiType type={ret} links={links} />
    </SignatureBlock>
  );
}

export function Badges({
  items = [],
  source,
}: {
  items?: { label: string; variant?: BadgeVariant }[];
  source?: string;
}) {
  if (items.length === 0 && !source) return null;
  return (
    <div className="not-prose -mt-2 mb-4 flex flex-wrap items-center gap-1.5">
      {items.map((item) => (
        <span
          key={item.label}
          className={cn(
            'rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-medium',
            badgeVariants[item.variant ?? 'default'],
          )}
        >
          {item.label}
        </span>
      ))}
      {source && (
        <a
          href={source}
          title="View source"
          className="ms-auto rounded-md px-1.5 py-0.5 font-mono text-xs text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground"
        >
          {'</>'}
        </a>
      )}
    </div>
  );
}

export function RepoLink({ href }: { href: string }) {
  const label = href.replace(/^https:\/\/github\.com\//, '');
  return (
    <a
      href={href}
      className="not-prose inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium text-fd-foreground no-underline transition-colors hover:bg-fd-accent"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 fill-current">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
      {label}
    </a>
  );
}
