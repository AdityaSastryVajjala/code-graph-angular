/**
 * Unit tests for GitDiffDetector.
 * Mocks child_process.execSync.
 */

import { detectChanges } from '../../../src/incremental/detectors/git-diff-detector.js';

jest.mock('child_process');

import { execSync } from 'child_process';

// Use jest.Mock cast to avoid Buffer/string overload ambiguity
const mockExecSync = execSync as jest.Mock;

describe('GitDiffDetector', () => {
  const appRoot = '/project/apps/myapp';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('classifies added files correctly', () => {
    mockExecSync.mockReturnValue('A\tapps/myapp/src/app/new.component.ts\n');
    const result = detectChanges(appRoot, 'HEAD~1', 'HEAD');
    expect(result.files[0].kind).toBe('added');
    expect(result.files[0].path).toContain('new.component.ts');
  });

  it('classifies modified files correctly', () => {
    mockExecSync.mockReturnValue('M\tapps/myapp/src/app/app.component.ts\n');
    const result = detectChanges(appRoot, 'HEAD~1', 'HEAD');
    expect(result.files[0].kind).toBe('modified');
  });

  it('classifies deleted files correctly', () => {
    mockExecSync.mockReturnValue('D\tapps/myapp/src/app/old.component.ts\n');
    const result = detectChanges(appRoot, 'HEAD~1', 'HEAD');
    expect(result.files[0].kind).toBe('deleted');
  });

  it('excludes files outside appRoot', () => {
    // Use a path that resolves outside appRoot (relative to repo root via ../)
    mockExecSync.mockReturnValue('M\t../other-app/src/app/app.component.ts\n');
    const result = detectChanges(appRoot, 'HEAD~1', 'HEAD');
    expect(result.files).toHaveLength(0);
  });

  it('excludes non-TS and non-HTML files', () => {
    mockExecSync.mockReturnValue('M\tapps/myapp/src/app/styles.scss\nM\tapps/myapp/src/app/app.component.ts\n');
    const result = detectChanges(appRoot, 'HEAD~1', 'HEAD');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toContain('app.component.ts');
  });

  it('handles empty git diff output', () => {
    mockExecSync.mockReturnValue('');
    const result = detectChanges(appRoot, 'HEAD~1', 'HEAD');
    expect(result.files).toHaveLength(0);
  });

  it('throws if git diff fails', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });
    expect(() => detectChanges(appRoot, 'HEAD~1', 'HEAD')).toThrow('git diff failed');
  });
});
