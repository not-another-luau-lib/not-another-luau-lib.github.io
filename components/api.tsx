import type { CSSProperties, ReactNode } from 'react';
import { getHighlighter } from 'fumadocs-core/highlight';
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

// Types are colored by Shiki with the same themes as the code blocks, so signatures and code share
// one palette. Each piece is highlighted inside some Luau around it (`type _ = ...`) to get the
// colors it has in a type position.

const themes = { light: 'github-light', dark: 'github-dark' } as const;
const highlighter = getHighlighter('js', { langs: ['luau'], themes: Object.values(themes) });

interface Segment {
  text: string;
  light?: string;
  dark?: string;
}

// Segments for `body` as Shiki colors it within `prefix + body + suffix`.
async function luau(prefix: string, body: string, suffix = ''): Promise<Segment[]> {
  const code = prefix + body + suffix;
  const { tokens } = (await highlighter).codeToTokens(code, { lang: 'luau', themes });
  const start = prefix.length;
  const end = start + body.length;
  const segments: Segment[] = [];
  const push = (from: number, to: number, style?: Record<string, string>) => {
    const a = Math.max(from, start);
    const b = Math.min(to, end);
    if (a < b) segments.push({ text: code.slice(a, b), light: style?.color, dark: style?.['--shiki-dark'] });
  };

  let cursor = 0;
  for (const token of tokens.flat()) {
    push(cursor, token.offset); // newlines between lines
    push(token.offset, token.offset + token.content.length, token.htmlStyle as Record<string, string>);
    cursor = token.offset + token.content.length;
  }
  push(cursor, code.length);
  return segments;
}

// Renders segments, turning identifiers found in `links` into links of the same color.
function Colored({ segments, links = {}, className }: { segments: Segment[]; links?: Links; className?: string }) {
  return segments.map((segment, i) => {
    const style = { '--l': segment.light, '--d': segment.dark } as CSSProperties;
    const parts = segment.text.split(/([A-Za-z_]\w*)/).map((part, j) =>
      links[part] ? (
        <a key={j} href={links[part]} className="underline decoration-dotted underline-offset-2 hover:decoration-solid">
          {part}
        </a>
      ) : (
        part
      ),
    );
    return (
      <span key={i} style={style} className={cn(segment.light && 'text-(--l) dark:text-(--d)', className)}>
        {parts}
      </span>
    );
  });
}

export async function TypeCode({ type, links }: { type: string; links?: Links }) {
  return (
    <code className="rounded-md border bg-fd-muted px-1.5 py-0.5 text-[0.8125rem]">
      <Colored segments={await luau('type _ = ', type)} links={links} />
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

// A name colored like a type or function name.
async function Name({ text, bold }: { text: string; bold?: boolean }) {
  return <Colored segments={await luau('type ', text, ' = nil')} className={bold ? 'font-semibold' : undefined} />;
}

// `Owner.name(param: Type, ...) -> Return`, broken over lines once it gets long, like Moonwave.
// kind="type" renders `type Name = Type`, kind="value" renders `Owner.name: Type`.
export async function Signature({
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
        <Colored segments={await luau('', `type ${name} = ${type}`)} links={links} />
      </SignatureBlock>
    );
  }

  const prefix = owner ? (
    <>
      <Name text={owner} />
      {separator}
    </>
  ) : null;

  if (kind === 'value') {
    return (
      <SignatureBlock>
        {prefix}
        <Colored segments={await luau('type _ = { ', `${name}: ${type}`, ' }')} links={links} />
      </SignatureBlock>
    );
  }

  const list = params.map((p) => `${p.name}${p.type ? `: ${p.type}` : ''}`);
  const multiline = list.join(', ').length + name.length + (owner?.length ?? 0) > 60 && params.length > 1;
  const ret = returns.length === 0 ? '()' : returns.length === 1 ? returns[0] : `(${returns.join(', ')})`;
  const body = multiline ? `(\n    ${list.join(',\n    ')}\n) -> ${ret}` : `(${list.join(', ')}) -> ${ret}`;

  return (
    <SignatureBlock>
      {prefix}
      <Name text={name} bold />
      <Colored segments={await luau('type _ = ', body)} links={links} />
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

export function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
