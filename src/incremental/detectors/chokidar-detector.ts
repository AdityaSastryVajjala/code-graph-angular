/**
 * ChokidarDetector — watches an Angular app root for file changes using chokidar.
 *
 * Accumulates events and passes them to a RollingDebounce instance.
 * Returns a disposable watcher handle.
 */

import chokidar, { FSWatcher } from 'chokidar';
import { relative, resolve, isAbsolute } from 'path';
import { ChangedFile, ChangedFileSet, ChangeKind } from '../../core/types/graph-ir.js';

export interface Watcher {
  close(): Promise<void>;
}

/**
 * Start watching `appRoot` for .ts and .html changes.
 * Each batch of accumulated events is passed to `onChanges`.
 *
 * @param appRoot    Absolute path to the Angular application root
 * @param onChanges  Callback invoked with the accumulated ChangedFileSet
 */
export function watch(
  appRoot: string,
  onChanges: (set: ChangedFileSet) => void,
): Watcher {
  const absRoot = isAbsolute(appRoot) ? appRoot : resolve(appRoot);

  const watcher: FSWatcher = chokidar.watch(absRoot, {
    ignored: [/node_modules/, /dist/, /\.git/],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  const pending = new Map<string, ChangeKind>();

  function flush(): void {
    if (pending.size === 0) return;
    const files: ChangedFile[] = Array.from(pending.entries()).map(([path, kind]) => ({
      path,
      kind,
    }));
    pending.clear();
    onChanges({ files, detectedAt: new Date() });
  }

  function handleEvent(kind: ChangeKind) {
    return (absolutePath: string) => {
      if (!absolutePath.endsWith('.ts') && !absolutePath.endsWith('.html')) return;
      const relPath = relative(absRoot, absolutePath);
      // Later events override earlier ones for the same file
      pending.set(relPath, kind);
    };
  }

  watcher
    .on('add', handleEvent('added'))
    .on('change', handleEvent('modified'))
    .on('unlink', handleEvent('deleted'));

  // Expose accumulated events via flush — used by RollingDebounce
  (watcher as FSWatcher & { _flushPending?: () => void })._flushPending = flush;

  return {
    close: () => watcher.close(),
  };
}
