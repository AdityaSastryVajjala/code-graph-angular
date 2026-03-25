/**
 * GitDiffDetector — detects changed files between two git refs.
 *
 * Used in CI pipelines where changed files come from git diff output.
 */

import { execSync } from 'child_process';
import { ChangedFile, ChangedFileSet, ChangeKind } from '../../core/types/graph-ir.js';
import { relative, isAbsolute, resolve } from 'path';

/**
 * Detect changed files between two git refs.
 * Returns only .ts and .html files within `appRoot`.
 *
 * @param appRoot  Absolute path to the application root
 * @param base     Base git ref (e.g., 'HEAD~1', 'main')
 * @param head     Head git ref (e.g., 'HEAD')
 */
export function detectChanges(
  appRoot: string,
  base: string,
  head: string,
): ChangedFileSet {
  const absRoot = isAbsolute(appRoot) ? appRoot : resolve(appRoot);

  let output: string;
  try {
    output = execSync(
      `git diff --name-status ${base}..${head}`,
      { cwd: absRoot, encoding: 'utf-8' },
    );
  } catch (err) {
    throw new Error(
      `git diff failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const files: ChangedFile[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Format: STATUS\tFILE_PATH
    const parts = trimmed.split(/\t/);
    if (parts.length < 2) continue;

    const statusChar = parts[0].charAt(0).toUpperCase();
    const filePath = parts[parts.length - 1]; // handle rename format A/B

    // Only .ts and .html files
    if (!filePath.endsWith('.ts') && !filePath.endsWith('.html')) continue;

    // Only files within appRoot
    const absFilePath = isAbsolute(filePath) ? filePath : resolve(absRoot, filePath);
    const relToRoot = relative(absRoot, absFilePath);
    if (relToRoot.startsWith('..')) continue; // outside appRoot

    let kind: ChangeKind;
    if (statusChar === 'A') kind = 'added';
    else if (statusChar === 'D') kind = 'deleted';
    else kind = 'modified'; // M, R (rename), C (copy)

    files.push({ path: relToRoot, kind });
  }

  return { files, detectedAt: new Date() };
}
