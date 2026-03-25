/**
 * Structured logger — emits JSON lines to stderr.
 *
 * Observability signals (constitution Principle VII):
 *  - indexing_start
 *  - indexing_complete  (duration, nodeCount, edgeCount, fileCount)
 *  - incremental_update (deltaNodes, deltaEdges, changedFiles, duration)
 *  - error              (filePath?, message, stack?)
 *  - info               (message, ...meta)
 *  - warn               (message, ...meta)
 */

import { IndexStats, IncrementalStats } from '../core/types/graph-ir.js';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogLine {
  timestamp: string;
  level: LogLevel;
  event: string;
  [key: string]: unknown;
}

function emit(line: LogLine): void {
  process.stderr.write(JSON.stringify(line) + '\n');
}

function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>): void {
    emit({ timestamp: timestamp(), level: 'info', event: 'info', message, ...meta });
  },

  warn(message: string, meta?: Record<string, unknown>): void {
    emit({ timestamp: timestamp(), level: 'warn', event: 'warn', message, ...meta });
  },

  error(message: string, filePath?: string, error?: Error): void {
    emit({
      timestamp: timestamp(),
      level: 'error',
      event: 'error',
      message,
      filePath,
      stack: error?.stack,
    });
  },

  indexingStart(appName: string, fileCount: number): void {
    emit({
      timestamp: timestamp(),
      level: 'info',
      event: 'indexing_start',
      appName,
      fileCount,
    });
  },

  indexingComplete(stats: IndexStats): void {
    emit({
      timestamp: timestamp(),
      level: 'info',
      event: 'indexing_complete',
      ...stats,
    });
  },

  incrementalUpdate(stats: IncrementalStats): void {
    emit({
      timestamp: timestamp(),
      level: 'info',
      event: 'incremental_update',
      ...stats,
    });
  },

  debug(message: string, meta?: Record<string, unknown>): void {
    if (process.env['CODEGRAPH_DEBUG']) {
      emit({ timestamp: timestamp(), level: 'debug', event: 'debug', message, ...meta });
    }
  },
};
