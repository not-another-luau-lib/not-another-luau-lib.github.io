import { appName } from '@/lib/shared';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold ${className ?? ''}`}>
      {appName}
    </span>
  );
}
