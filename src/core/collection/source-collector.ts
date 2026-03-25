/**
 * SourceCollector — discovers all relevant source files in an Angular app root.
 */

import fg from 'fast-glob';
import { resolve } from 'path';
import { SourceFileSet } from '../types/graph-ir.js';

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
];

/**
 * Collect all TypeScript, HTML template, and spec files for the given app root.
 * All returned paths are absolute.
 */
export async function collectFiles(appRoot: string): Promise<SourceFileSet> {
  const absRoot = resolve(appRoot);

  const [tsFiles, htmlFiles] = await Promise.all([
    fg('**/*.ts', {
      cwd: absRoot,
      absolute: true,
      ignore: [...IGNORE_PATTERNS, '**/*.spec.ts'],
    }),
    fg('**/*.html', {
      cwd: absRoot,
      absolute: true,
      ignore: IGNORE_PATTERNS,
    }),
  ]);

  const specFiles = await fg('**/*.spec.ts', {
    cwd: absRoot,
    absolute: true,
    ignore: IGNORE_PATTERNS,
  });

  return { tsFiles, htmlFiles, specFiles };
}
