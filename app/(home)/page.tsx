import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">not-another-luau-lib</h1>
      <p className="max-w-md text-fd-muted-foreground">
        Small, focused Luau libraries for Roblox, on ember, pesde and wally.
      </p>
      <Link href="/docs" className="rounded-full bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground no-underline">
        Browse the libraries
      </Link>
    </main>
  );
}
