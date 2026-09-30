import { Figtree, JetBrains_Mono } from 'next/font/google';
import { Provider } from '@/components/provider';
import type { Metadata } from 'next';
import { appName } from '@/lib/shared';
import './global.css';

const sans = Figtree({
  subsets: ['latin'],
  variable: '--font-sans',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: {
    default: appName,
    template: `%s | ${appName}`,
  },
  description: 'Small, focused Luau libraries for Roblox.',
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${sans.className}`} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
