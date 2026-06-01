import type { Page } from 'playwright';
import { BaseScraper } from './base.js';
import { logger } from '../utils/logger.js';

/**
 * A single recording entry from a SharePoint folder.
 */
export interface RecordingEntry {
  /** Display name of the recording file */
  name: string;
  /** Full SharePoint URL to the .mp4 file */
  url: string;
  /** Modification date (ISO string if available) */
  modified: string;
  /** Base SharePoint site URL (e.g., /sites/sc5053...) */
  sitePath: string;
  /** Recording date parsed from filename (YYYYMMDD) */
  date?: string;
}

/**
 * Scrapes a SharePoint document library folder for Teams meeting recordings.
 *
 * Works with the standard SharePoint "All Documents" list view.
 * Extracts filename, URL, and modification date for each .mp4 file.
 *
 * ## Usage
 *
 * ```ts
 * const scraper = new SharePointRecordingsScraper();
 * const result = await scraper.run({
 *   urls: ['https://...sharepoint.com/sites/.../Recordings/'],
 *   onItem: (data) => console.log(data.payload.recordings),
 * });
 * ```
 */
export class SharePointRecordingsScraper extends BaseScraper {
  /**
   * Extract recording entries from the SharePoint list view.
   */
  async extract(page: Page): Promise<Record<string, unknown>> {
    // Wait for the document grid to load
    await page.waitForSelector('[role="grid"]', { timeout: 15_000 }).catch(() => {
      logger.warn('Grid not found — trying alternative selectors');
    });

    // Give SharePoint's JS time to render
    await page.waitForTimeout(2000);

    const recordings: RecordingEntry[] = [];
    const baseUrl = page.url();
    const sitePath = extractSitePath(baseUrl);

    // Strategy 1: Extract from grid rows (SharePoint modern UI)
    const rows = await page.$$('[role="row"]').catch(() => []);

    for (const row of rows) {
      try {
        const cells = await row.$$('[role="gridcell"]');
        if (cells.length < 3) continue;

        // Cell 1: name + link
        const nameEl = await cells[1]?.$('button, a, span');
        const name = (await nameEl?.innerText())?.trim() ?? '';
        const href = (await nameEl?.getAttribute('href')) ?? '';

        // Only process .mp4 files
        if (!name.endsWith('.mp4')) continue;

        // Cell 2: modified date
        const dateText =
          (await cells[2]?.innerText())?.trim() ?? '';

        const url = href.startsWith('http')
          ? href
          : resolveSharePointUrl(baseUrl, href, name);

        recordings.push({
          name,
          url,
          modified: dateText,
          sitePath,
          date: extractDateFromFilename(name),
        });
      } catch {
        // Skip malformed rows
      }
    }

    // Strategy 2: Fallback — extract links ending in .mp4
    if (recordings.length === 0) {
      logger.warn('Grid extraction found 0 recordings — trying link extraction');
      const links = await page.$$('a[href$=".mp4"]');

      for (const link of links) {
        const name = (await link.innerText())?.trim() ?? '';
        const href = (await link.getAttribute('href')) ?? '';

        recordings.push({
          name: name || href.split('/').pop()!,
          url: resolveSharePointUrl(baseUrl, href, name),
          modified: '',
          sitePath,
          date: extractDateFromFilename(name || href),
        });
      }
    }

    logger.info(
      `Found ${recordings.length} recording(s) in ${sitePath}`,
    );

    return { recordings, sitePath, folderUrl: baseUrl };
  }
}

// ── Helpers ────────────────────────────────────────────

/** Extract the site path from a SharePoint URL */
function extractSitePath(url: string): string {
  const match = url.match(/\/sites\/[^/]+/);
  return match ? match[0] : url;
}

/** Resolve a relative SharePoint URL to absolute */
function resolveSharePointUrl(
  baseUrl: string,
  href: string,
  fallbackName: string,
): string {
  if (href.startsWith('http')) return href;

  const base = new URL(baseUrl);
  if (href.startsWith('/')) {
    return `${base.origin}${href}`;
  }

  // Relative — construct from base path
  const pathParts = base.pathname.split('/');
  // Remove filename if present
  if (pathParts[pathParts.length - 1]?.includes('.')) {
    pathParts.pop();
  }
  return `${base.origin}${pathParts.join('/')}/${fallbackName}`;
}

/** Extract YYYYMMDD date from Teams recording filename */
function extractDateFromFilename(name: string): string | undefined {
  // Pattern: ...-YYYYMMDD_HHMMSS-Meeting Recording.mp4
  const match = name.match(/(\d{8})_\d{6}/);
  return match ? match[1] : undefined;
}
