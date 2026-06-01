/**
 * Shared type definitions for NOX scrapers.
 */

import type { ActionDef } from '../config/schema.js';

/** A generic extracted data record */
export interface ExtractedData {
  url: string;
  extractedAt: string;
  payload: Record<string, unknown>;
}

/** Session configuration for a scrape run */
export interface SessionConfig {
  /** Load a previously saved session (cookies + localStorage) */
  load?: string;
  /** Save session after scraping under this name */
  save?: string;
  /** Run these login actions BEFORE scraping (only if no session loaded) */
  login?: ActionDef[];
  /** URL to navigate to before login actions */
  loginUrl?: string;
}

/** Options passed to a scraper's run() method */
export interface ScrapeOptions {
  urls: string[];
  concurrency?: number;
  onItem?: (data: ExtractedData) => void | Promise<void>;
  /** Session management */
  session?: SessionConfig;
  /** Pre-scrape actions (applied to every URL) */
  actions?: ActionDef[];
}

/** Result of a scrape run */
export interface ScrapeResult {
  total: number;
  errors: Error[];
  durationMs: number;
}
