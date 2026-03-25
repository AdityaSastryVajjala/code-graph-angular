/**
 * Neo4j connection factory.
 * Provides Driver and Session lifecycle management.
 */

import neo4j, { Driver, Session } from 'neo4j-driver';

export interface ConnectionOptions {
  url: string;
  user: string;
  password: string;
}

/**
 * Create and validate a Neo4j driver.
 * Throws if the connection cannot be established.
 */
export async function createDriver(options: ConnectionOptions): Promise<Driver> {
  const driver = neo4j.driver(
    options.url,
    neo4j.auth.basic(options.user, options.password),
    {
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 10000,
    },
  );

  // Validate connection immediately
  await driver.verifyConnectivity();
  return driver;
}

/**
 * Open a session scoped to a specific database.
 */
export function getSession(driver: Driver, database: string): Session {
  return driver.session({ database });
}

/**
 * Close the driver, releasing all pooled connections.
 */
export async function closeDriver(driver: Driver): Promise<void> {
  await driver.close();
}
