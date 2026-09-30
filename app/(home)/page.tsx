import Link from 'next/link';
import { ArrowRight, Package } from 'lucide-react';
import { getLibraries, type Library } from '@/lib/libraries';
import { gitConfig } from '@/lib/shared';

export default function HomePage() {
  const libraries = getLibraries();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-4 py-16 md:px-6 md:py-24">
      <section className="flex flex-col items-start gap-6">
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
          not-another-<span className="text-fd-primary">luau</span>-lib
        </h1>
        <p className="max-w-xl text-lg text-fd-muted-foreground">
          A collection of small, focused Luau libraries for Roblox. Each one does a single thing, is fully
          typed, and is documented from its source.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/docs/getting-started"
            className="inline-flex items-center gap-2 rounded-full bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground"
          >
            Get started
            <ArrowRight className="size-4" />
          </Link>
          <a
            href={`https://github.com/${gitConfig.user}`}
            className="inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent"
          >
            View on GitHub
          </a>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Libraries</h2>
          <p className="text-sm text-fd-muted-foreground">
            {libraries.length} {libraries.length === 1 ? 'library' : 'libraries'}
          </p>
        </div>

        {libraries.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {libraries.map((library) => (
              <LibraryCard key={library.slug} library={library} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
            <Package className="size-6 text-fd-muted-foreground" />
            <p className="font-medium">No library yet</p>
            <p className="max-w-sm text-sm text-fd-muted-foreground">
              Libraries appear here as soon as their repository is public on GitHub.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

function LibraryCard({ library }: { library: Library }) {
  const version = Object.values(library.packages)[0]?.version;

  return (
    <Link
      href={library.href}
      className="group flex flex-col gap-3 rounded-xl border bg-fd-card p-5 transition-colors hover:border-fd-primary/50 hover:bg-fd-accent/50"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fd-primary/10 font-mono text-sm font-semibold text-fd-primary">
          {library.title.slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{library.title}</p>
          {version && <p className="font-mono text-xs text-fd-muted-foreground">v{version}</p>}
        </div>
        <ArrowRight className="size-4 shrink-0 text-fd-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-fd-primary" />
      </div>
      <p className="line-clamp-2 text-sm text-fd-muted-foreground">{library.description}</p>
    </Link>
  );
}
