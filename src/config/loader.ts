import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { noxConfigSchema, type NoxFileConfig } from './schema.js';
import { logger } from '../utils/logger.js';

/**
 * Load and validate a NOX config JSON file.
 *
 * Usage:
 *   const config = loadConfig('./my-scrape.json');
 *   // config.jobs[...], config.browser.wsEndpoint, etc.
 */

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(filePath: string): NoxFileConfig {
  const resolved = resolve(filePath);

  if (!existsSync(resolved)) {
    throw new ConfigError(`Config file not found: ${resolved}`);
  }

  let raw: unknown;
  try {
    const content = readFileSync(resolved, 'utf-8');
    raw = JSON.parse(content);
  } catch (err) {
    throw new ConfigError(
      `Failed to parse JSON: ${(err as Error).message}`,
      (err as Error).message,
    );
  }

  const { error, value } = noxConfigSchema.validate(raw, {
    abortEarly: false,
    stripUnknown: false,
  });

  if (error) {
    const messages = error.details.map(
      (d) => `  • ${d.path.join('.')}: ${d.message}`,
    );
    throw new ConfigError(
      `Invalid config (${error.details.length} error(s)):\n${messages.join('\n')}`,
      error.details,
    );
  }

  logger.info(`Loaded config: ${resolved} (${value.jobs.length} job(s))`);
  return value as NoxFileConfig;
}

/**
 * Try to load the config. Returns [config, null] on success, [null, error] on failure.
 */
export function tryLoadConfig(
  filePath: string,
): [NoxFileConfig, null] | [null, ConfigError] {
  try {
    return [loadConfig(filePath), null];
  } catch (err) {
    return [null, err as ConfigError];
  }
}
