/**
 * The corpus: markdown of github.com/nestjs/docs.nestjs.com (MIT), kept as a shallow clone in
 * data/raw/ (git-ignored). Which files are pages, and at which URL, comes from the site itself.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const DOCS_REPO = 'https://github.com/nestjs/docs.nestjs.com.git';
export const DOCS_BRANCH = 'master';
export const DOCS_SITE = 'https://docs.nestjs.com';
export const DEFAULT_SOURCE_DIR = fileURLToPath(
  new URL('../../../../data/raw/docs.nestjs.com', import.meta.url),
);

/** Clones the docs, or fast-forwards an existing clone. Returns the commit being indexed. */
export async function syncSource(dir: string, { offline = false } = {}): Promise<string> {
  if (!existsSync(join(dir, '.git'))) {
    if (offline) throw new Error(`No docs clone at ${dir}; run once without --offline`);
    await run('git', ['clone', '--quiet', '--depth', '1', '--branch', DOCS_BRANCH, DOCS_REPO, dir]);
  } else if (!offline) {
    await run('git', ['-C', dir, 'fetch', '--quiet', '--depth', '1', 'origin', DOCS_BRANCH]);
    await run('git', ['-C', dir, 'reset', '--quiet', '--hard', 'FETCH_HEAD']);
  }
  const { stdout } = await run('git', ['-C', dir, 'rev-parse', 'HEAD']);
  return stdout.trim();
}

export interface DocPage {
  /** Site route, e.g. "/fundamentals/custom-providers". */
  route: string;
  url: string;
  /** Markdown file relative to the clone, e.g. "content/fundamentals/dependency-injection.md". */
  file: string;
}

/**
 * Pages as the site publishes them. Routes are the sidebar (`src/app/shared/nav/nav-items.ts`);
 * a route whose file was renamed is mapped by `CONTENT_ALIASES` in the site's own llms.txt
 * generator. Both are read as text — nothing from the clone is executed.
 */
export function listPages(dir: string): { pages: DocPage[]; missing: string[] } {
  const nav = readFileSync(join(dir, 'src/app/shared/nav/nav-items.ts'), 'utf8');
  const routes = [
    ...new Set(
      Array.from(
        nav
          .split('\n')
          .filter((line) => !line.trim().startsWith('//'))
          .join('\n')
          .matchAll(/\bpath:\s*'([^']+)'/g),
        (m) => m[1]!,
      ),
    ),
  ];
  if (routes.length === 0)
    throw new Error('No routes found in nav-items.ts — has its format changed?');

  const generator = readFileSync(join(dir, 'tools/generate-llms-txt.ts'), 'utf8');
  const block = generator.match(/CONTENT_ALIASES[^=]*=\s*\{([\s\S]*?)\};/)?.[1];
  if (!block) throw new Error('CONTENT_ALIASES not found in generate-llms-txt.ts — has it moved?');
  const aliases = new Map(
    Array.from(block.matchAll(/'([^']+)':\s*'([^']+)'/g), (m) => [m[1]!, m[2]!]),
  );

  const pages: DocPage[] = [];
  const missing: string[] = [];
  for (const route of routes) {
    const file = `content/${aliases.get(route) ?? route.replace(/^\//, '')}.md`;
    if (!existsSync(join(dir, file))) {
      missing.push(route);
      continue;
    }
    pages.push({ route, url: route === '/' ? DOCS_SITE : `${DOCS_SITE}${route}`, file });
  }
  return { pages, missing };
}
