/**
 * Shared type definitions for NOX scrapers.
 */

/** A generic extracted data record */
export interface ExtractedData {
  /** Source URL */
  url: string;
  /** When it was extracted */
  extractedAt: string;
  /** Arbitrary key-value payload */
  payload: Record<string, unknown>;
}

/** Options passed to a scraper's run() method */
export interface ScrapeOptions {
  /** Target URL(s) */
  urls: string[];
  /** Max concurrent pages (default: 1) */
  concurrency?: number;
  /** Callback for each extracted item */
  onItem?: (data: ExtractedData) => void | Promise<void>;
}

/** Result of a scrape run */
export interface ScrapeResult {
  /** Total items extracted */
  total: number;
  /** Errors encountered */
  errors: Error[];
  /** Duration in ms */
  durationMs: number;
}
