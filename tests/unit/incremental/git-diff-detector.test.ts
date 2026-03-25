/**
 * Unit tests for GitDiffDetector.
 * Mocks child_process.execSync.
 */

import { detectChanges } from '../../../src/incremental/detectors/git-diff-detector.js';

jest.mock('child_process');

import { execSync } from 'child_process';

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('GitDiffDetector', () => {
  const appRoot = '/project/apps/myapp';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('classifies added files correctly', () => {
    mockExecSync.mockReturnValue(
      'A\tapps/myapp/src/app/new.component.ts\n' as unknown as Buffer,
    );
    const result = detectChanges(appRoot, 'HEAD~1', 'HEAD');
    expect(result.files[0].kind).toBe('added');
    expect(result.files[0].path).toContain('new.component.ts');
  });

  it('classifies modified files correctly', () => {
    mockExecSync.mockReturnValue(
      'M\tapps/myapp/src/app/app.component.ts\n' as unknown as Buffer,
    );
    const result = detectChanges(appRoot, 'HEAD~1', 'HEAD');
    expect(result.files[0].kind).toBe('modified');
  });

  it('classifies deleted files correctly', () => {
    mockExecSync.mockReturnValue(
      'D\tapps/myapp/src/app/old.component.ts\n' as unknown as Buffer,
    );
    const result = detectChanges(appRoot, 'HEAD~1', 'HEAD');
    expect(result.files[0].kind).toBe('deleted');
  });

  it('excludes files outside appRoot', () => {
    mockExecSync.mockReturnValue(
      'M\tapps/other-app/src/app/app.component.ts\n' as unknown as Buffer,
    );
    const result = detectChanges(appRoot, 'HEAD~1', 'HEAD');
    expect(result.files).toHaveLength(0);
  });

  it('excludes non-TS and non-HTML files', () => {
    mockExecSync.mockReturnValue(
      'M\tapps/myapp/src/app/styles.scss\nM\tapps/myapp/src/app/app.component.ts\n' as unknown as Buffer,
    );
    const result = detectChanges(appRoot, 'HEAD~1', 'HEAD');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toContain('app.component.ts');
  });

  it('handles empty git diff output', () => {
    mockExecSync.mockReturnValue('' as unknown as Buffer);
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
