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

export function ApiType({ type, links = {} }: { type: string; links?: Links }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of type.matchAll(/[A-Za-z_][\w]*/g)) {
    const href = links[match[0]];
    if (!href) continue;
    parts.push(type.slice(last, match.index));
    parts.push(
      <a key={match.index} href={href} className="text-fd-primary underline-offset-2 hover:underline">
        {match[0]}
      </a>,
    );
    last = match.index + match[0].length;
  }
  parts.push(type.slice(last));
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
        <span className="text-fd-muted-foreground">type </span>
        <span className="font-semibold text-fd-foreground">{name}</span>
        <span className="text-fd-muted-foreground"> = </span>
        <ApiType type={type} links={links} />
      </SignatureBlock>
    );
  }

  if (kind === 'value') {
    return (
      <SignatureBlock>
        {owner && <span className="text-fd-muted-foreground">{owner}.</span>}
        <span className="font-semibold text-fd-foreground">{name}</span>
        <span className="text-fd-muted-foreground">: </span>
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
        <span className="text-fd-muted-foreground">
          {owner}
          {separator}
        </span>
      )}
      <span className="font-semibold text-fd-foreground">{name}</span>
      <span className="text-fd-muted-foreground">(</span>
      {multiline && '\n'}
      {params.map((param, i) => (
        <Fragment key={param.name + i}>
          {multiline && '    '}
          <span>{param.name}</span>
          {param.type && (
            <>
              <span className="text-fd-muted-foreground">: </span>
              <ApiType type={param.type} links={links} />
            </>
          )}
          {i < params.length - 1 && <span className="text-fd-muted-foreground">,{multiline ? '' : ' '}</span>}
          {multiline && '\n'}
        </Fragment>
      ))}
      <span className="text-fd-muted-foreground">) → </span>
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
