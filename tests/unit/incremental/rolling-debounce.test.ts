/**
 * Unit tests for RollingDebounce.
 */

import { RollingDebounce } from '../../../src/incremental/debounce/rolling-debounce.js';
import { ChangedFileSet } from '../../../src/core/types/graph-ir.js';

jest.useFakeTimers();

function makeSet(paths: string[]): ChangedFileSet {
  return {
    files: paths.map((p) => ({ path: p, kind: 'modified' as const })),
    detectedAt: new Date(),
  };
}

describe('RollingDebounce', () => {
  let flushCalls: ChangedFileSet[];
  let debounce: RollingDebounce;

  beforeEach(() => {
    flushCalls = [];
    debounce = new RollingDebounce(30_000, (set) => flushCalls.push(set));
    // Suppress stdout during tests
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    debounce.cancel();
    jest.clearAllTimers();
    jest.restoreAllMocks();
  });

  it('flushes after windowMs with no new events', () => {
    debounce.push(makeSet(['src/app/app.component.ts']));
    expect(flushCalls).toHaveLength(0);

    jest.advanceTimersByTime(30_000);
    expect(flushCalls).toHaveLength(1);
    expect(flushCalls[0].files).toHaveLength(1);
  });

  it('resetting timer on a new push delays flush', () => {
    debounce.push(makeSet(['file1.ts']));
    jest.advanceTimersByTime(20_000);

    // New push should reset the timer
    debounce.push(makeSet(['file2.ts']));
    jest.advanceTimersByTime(20_000); // total 40s, but reset at 20s, so only 20s since last push

    expect(flushCalls).toHaveLength(0); // timer was reset, not fired yet

    jest.advanceTimersByTime(10_000); // now 30s since last push
    expect(flushCalls).toHaveLength(1);
  });

  it('accumulates multiple pushes into a single flush set', () => {
    debounce.push(makeSet(['file1.ts']));
    debounce.push(makeSet(['file2.ts']));
    debounce.push(makeSet(['file3.ts']));

    jest.advanceTimersByTime(30_000);

    expect(flushCalls).toHaveLength(1);
    const paths = flushCalls[0].files.map((f) => f.path);
    expect(paths).toContain('file1.ts');
    expect(paths).toContain('file2.ts');
    expect(paths).toContain('file3.ts');
  });

  it('later push for same file overwrites earlier kind', () => {
    debounce.push(makeSet(['file.ts'])); // modified
    debounce.push({
      files: [{ path: 'file.ts', kind: 'deleted' }],
      detectedAt: new Date(),
    });

    jest.advanceTimersByTime(30_000);

    expect(flushCalls).toHaveLength(1);
    expect(flushCalls[0].files[0].kind).toBe('deleted');
  });

  it('forceFlush fires immediately', () => {
    debounce.push(makeSet(['file.ts']));
    debounce.forceFlush();

    expect(flushCalls).toHaveLength(1);
  });

  it('cancel discards accumulated state', () => {
    debounce.push(makeSet(['file.ts']));
    debounce.cancel();

    jest.advanceTimersByTime(30_000);
    expect(flushCalls).toHaveLength(0);
  });
});
