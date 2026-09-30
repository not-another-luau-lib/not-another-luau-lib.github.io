import fs from 'node:fs';
import path from 'node:path';

export type Registry = 'ember' | 'pesde' | 'wally';

export interface Library {
  title: string;
  slug: string;
  description: string;
  repository?: string;
  packages: Partial<Record<Registry, { name: string; version: string; url: string }>>;
}

// Written by scripts/generate.mjs; only holds libraries whose repository is public on GitHub.
export function getLibraries(): Library[] {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'content/libraries.json'), 'utf8'));
  } catch {
    return [];
  }
}
