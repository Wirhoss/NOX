/// <reference types="node" />

/**
 * NOX — Web data extraction with Playwright + TypeScript + Bun
 *
 * Uses Playwright's browser automation to extract structured
 * data from web pages. Configured via JSON + Joi validation.
 */

// Config
export { configure, getConfig } from './config.js';
export type { NoxConfig, BrowserConfig } from './config.js';

// Config loader & schema
export { loadConfig, tryLoadConfig, ConfigError } from './config/loader.js';
export { noxConfigSchema } from './config/schema.js';
export type {
  NoxFileConfig,
  JobDef,
  SelectorDef,
  ActionDef,
} from './config/schema.js';

// Types
export type { ExtractedData, ScrapeOptions, ScrapeResult } from './types/index.js';

// Scrapers
export { BaseScraper } from './scrapers/base.js';
