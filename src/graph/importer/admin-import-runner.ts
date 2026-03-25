/**
 * AdminImportRunner — shells out to `neo4j-admin database import full`
 * to perform an offline bulk import from CSV files.
 *
 * Docker mode (default):
 *   1. Inspect the running container to discover its image + data volume.
 *   2. `docker stop <container>` — releases the data volume.
 *   3. Remove stale transaction logs via a one-shot alpine container.
 *      (Without this, Neo4j replays the old tx log on restart and reverts
 *      the store to its pre-import state.)
 *   4. `docker run --rm` a one-shot container with the same image + data
 *      volume to execute `neo4j-admin database import full`.
 *      The local CSV directory is bind-mounted at /import; no docker cp needed.
 *   5. `docker start <container>` (always, even on import failure).
 *
 * Local mode (containerName: null):
 *   Runs the neo4j-admin binary directly (must be on PATH or via neo4jAdminBin).
 *
 * After this function returns, the Neo4j service will be restarting.
 * The caller is responsible for waiting until Bolt accepts connections again
 * before issuing any Cypher commands.
 */

import { spawnSync } from 'child_process';
import { basename } from 'path';
import { CsvManifest } from '../writer/csv-writer.js';
import { logger } from '../../shared/logger.js';

export interface AdminImportOptions {
  /**
   * Name of the running Docker container that hosts Neo4j.
   * Default: 'codegraph-neo4j' (matches docker/docker-compose.yml).
   * Set to `null` to use a local (non-Docker) Neo4j installation.
   */
  containerName?: string | null;
  /**
   * Neo4j Docker image to use for the one-shot import container.
   * Default: auto-detected from the running container via `docker inspect`.
   * Only used in Docker mode.
   */
  neo4jImage?: string;
  /**
   * Path to the `neo4j-admin` binary.
   * Default: 'neo4j-admin' (expected on PATH).
   * Only used in local (non-Docker) mode.
   */
  neo4jAdminBin?: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function spawnOrThrow(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, { stdio: 'inherit', encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Process exited with code ${result.status}: ${cmd} ${args.join(' ')}`);
  }
}

/**
 * Run a docker inspect query and return trimmed stdout, or '' on failure.
 */
function dockerInspect(containerName: string, format: string): string {
  const result = spawnSync(
    'docker', ['inspect', '--format', format, containerName],
    { encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) return '';
  return result.stdout.trim();
}

/** Return the image the container was started from, e.g. 'neo4j:5.26.0-enterprise'. */
function getContainerImage(containerName: string): string {
  return dockerInspect(containerName, '{{.Config.Image}}');
}

/**
 * Return the name of the Docker volume mounted at /data inside the container.
 * docker-compose prefixes volume names with the compose project name
 * (e.g. 'docker_neo4j_data'), so we discover the real name at runtime.
 */
function getContainerDataVolume(containerName: string): string | null {
  const vol = dockerInspect(
    containerName,
    '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}',
  );
  return vol || null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run `neo4j-admin database import full` for `dbName` using the CSV files
 * described in `manifest`.
 *
 * Synchronous: blocks until the import subprocess exits.
 * Throws on non-zero exit code.
 */
export function runNeo4jAdminImport(
  dbName: string,
  manifest: CsvManifest,
  options: AdminImportOptions = {},
): void {
  const {
    containerName = 'codegraph-neo4j',
    neo4jAdminBin = 'neo4j-admin',
  } = options;

  const useDocker = containerName != null;

  // ── Build import arguments ────────────────────────────────────────────────
  // In Docker mode, CSVs are accessible at /import/<filename> inside the
  // one-shot container.  In local mode, use the absolute host paths.
  const pathPrefix = useDocker ? '/import' : manifest.dir;

  const nodeArgs = [...manifest.nodeFiles.entries()].map(
    ([label, localPath]) =>
      `--nodes=${label}=${pathPrefix}/${basename(localPath)}`,
  );

  const relArgs = [...manifest.relFiles.entries()].map(
    ([type, localPath]) =>
      `--relationships=${type}=${pathPrefix}/${basename(localPath)}`,
  );

  // Database name goes AFTER `--` to prevent picocli treating it as an
  // additional file argument for the variadic last --relationships flag.
  const importArgs = [
    'database', 'import', 'full',
    '--verbose',
    '--id-type=STRING',
    '--overwrite-destination=true',
    '--array-delimiter=;',
    '--multiline-fields=true',
    '--skip-bad-relationships=true',
    '--bad-tolerance=100000',
    ...nodeArgs,
    ...relArgs,
    '--',
    dbName,
  ];

  logger.info('neo4j_admin_import_start', {
    dbName,
    nodeLabels: [...manifest.nodeFiles.keys()],
    relTypes: [...manifest.relFiles.keys()],
    mode: useDocker ? `docker:${containerName}` : 'local',
  });

  // ── Execute ───────────────────────────────────────────────────────────────
  if (useDocker) {
    // Discover the real image + data volume BEFORE stopping the container.
    const neo4jImage = options.neo4jImage ?? getContainerImage(containerName);
    if (!neo4jImage) {
      throw new Error(
        `Could not detect Neo4j image from container '${containerName}'. ` +
        `Supply the 'neo4jImage' option explicitly.`,
      );
    }

    const dataVolume = getContainerDataVolume(containerName);
    if (!dataVolume) {
      throw new Error(
        `Could not detect data volume (/data mount) from container '${containerName}'.`,
      );
    }

    logger.info('docker_container_stop', { containerName });
    spawnOrThrow('docker', ['stop', containerName]);

    try {
      // Remove stale store files and transaction logs before import.
      //
      // Why both directories:
      //   /data/databases/{db}    — old store files (belt-and-suspenders; DROP
      //                             DATABASE should have removed these, but we
      //                             confirm here while the container is stopped)
      //   /data/transactions/{db} — old tx logs NOT covered by --overwrite-destination;
      //                             if they survive, Neo4j replays them on restart
      //                             and reverts the imported store to its pre-import
      //                             state, silently destroying all imported data.
      //
      // Use neo4jImage (already present on host) rather than alpine to avoid
      // a silent pull failure.  spawnOrThrow ensures we don't silently skip this.
      logger.info('remove_stale_data', { dbName, dataVolume });
      spawnOrThrow('docker', [
        'run', '--rm',
        '-v', `${dataVolume}:/data`,
        neo4jImage,
        'rm', '-rf',
        `/data/transactions/${dbName}`,
        `/data/databases/${dbName}`,
      ]);

      // Run neo4j-admin in a one-shot container.
      // The local CSV directory is bind-mounted at /import — no docker cp needed.
      // Forward-slashes required for the host path on Windows Docker Desktop.
      const hostImportDir = manifest.dir.replace(/\\/g, '/');

      spawnOrThrow('docker', [
        'run', '--rm',
        '--env=NEO4J_ACCEPT_LICENSE_AGREEMENT=eval',
        '-v', `${dataVolume}:/data`,
        '-v', `${hostImportDir}:/import`,
        neo4jImage,
        'neo4j-admin',
        ...importArgs,
      ]);
    } finally {
      // Always restart the container, even if the import failed.
      logger.info('docker_container_start', { containerName });
      spawnOrThrow('docker', ['start', containerName]);
    }
  } else {
    spawnOrThrow(neo4jAdminBin, importArgs);
  }

  logger.info('neo4j_admin_import_complete', { dbName });
}
