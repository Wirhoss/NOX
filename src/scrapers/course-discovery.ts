import type { Page } from 'playwright';
import { BaseScraper } from './base.js';
import { logger } from '../utils/logger.js';

/**
 * A discovered SharePoint course site.
 */
export interface CourseSite {
  /** Site title (e.g., "Administración de Proyectos...") */
  title: string;
  /** Full SharePoint URL */
  url: string;
  /** Site-relative path (e.g., /sites/sc5053fv12026bt_001) */
  path: string;
  /** Last modified date */
  lastModified?: string;
  /** Course code extracted from title/path (e.g., "SC-505") */
  courseCode?: string;
}

/**
 * Discovers all SharePoint course sites the user has access to.
 *
 * Uses SharePoint Search REST API to find all sites —
 * works regardless of how each professor organizes their files.
 *
 * ## Strategies (tried in order):
 *
 * 1. SharePoint Search API: `/_api/search/query?querytext='contentclass:STS_Site'`
 *    — Finds all sites regardless of folder structure
 * 2. SharePoint Search API with filter: adds "Campus Virtual" keyword
 * 3. My Sites page scraping (fallback)
 * 4. Microsoft Graph `/sites?search=*` (requires Graph token)
 *
 * ## Usage
 *
 * ```ts
 * const scraper = new CourseDiscoveryScraper('ufidelitas.sharepoint.com');
 * const result = await scraper.run({
 *   urls: ['https://ufidelitas.sharepoint.com/'],
 *   onItem: (data) => {
 *     for (const course of data.payload.courses as CourseSite[]) {
 *       console.log(course.title, course.url);
 *     }
 *   },
 * });
 * ```
 */
export class CourseDiscoveryScraper extends BaseScraper {
  private tenant: string;
  private keyword: string;

  /**
   * @param tenant - SharePoint tenant domain (e.g., 'ufidelitas.sharepoint.com')
   * @param keyword - Optional filter keyword (e.g., 'Campus Virtual', course code prefix)
   */
  constructor(tenant: string, keyword = '') {
    super();
    this.tenant = tenant;
    this.keyword = keyword;
  }

  async extract(page: Page): Promise<Record<string, unknown>> {
    const courses: CourseSite[] = [];

    // ── Strategy 1: SharePoint Search REST API ──────────
    try {
      const searchResults = await this.searchSitesViaAPI(page);
      courses.push(...searchResults);
    } catch (err) {
      logger.warn(`Search API failed: ${(err as Error).message}`);
    }

    // ── Strategy 2: Scrape SharePoint home / My Sites ──
    if (courses.length === 0) {
      try {
        const scraped = await this.scrapeMySites(page);
        courses.push(...scraped);
      } catch (err) {
        logger.warn(`My Sites scrape failed: ${(err as Error).message}`);
      }
    }

    // ── Strategy 3: Try Microsoft Graph via page context ─
    if (courses.length === 0) {
      try {
        const graphResults = await this.searchViaGraph(page);
        courses.push(...graphResults);
      } catch (err) {
        logger.warn(`Graph API failed: ${(err as Error).message}`);
      }
    }

    // Deduplicate by URL
    const seen = new Set<string>();
    const unique = courses.filter((c) => {
      const key = c.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    logger.info(`Discovered ${unique.length} course site(s)`);
    return { courses: unique, count: unique.length };
  }

  // ── Strategy 1: SharePoint Search REST API ────────────

  private async searchSitesViaAPI(page: Page): Promise<CourseSite[]> {
    // SharePoint REST Search: find all Site content types
    let query = "contentclass:STS_Site";
    if (this.keyword) {
      query += ` AND ${this.keyword}`;
    }

    const searchUrl = `https://${this.tenant}/_api/search/query?querytext='${encodeURIComponent(query)}'&selectproperties='Title,Path,LastModifiedTime,SPSiteUrl,SiteName'&rowlimit=500&sortlist='LastModifiedTime:descending'`;

    logger.debug(`Search API: ${searchUrl}`);

    const response = await page.evaluate(async (url) => {
      const res = await fetch(url, {
        headers: { Accept: 'application/json;odata=verbose' },
        credentials: 'include',
      });
      return res.json();
    }, searchUrl);

    return this.parseSearchResults(response);
  }

  private parseSearchResults(response: unknown): CourseSite[] {
    const courses: CourseSite[] = [];
    const data = response as {
      d?: {
        query?: {
          PrimaryQueryResult?: {
            RelevantResults?: {
              RowCount?: number;
              Table?: { Rows?: { results?: Array<{ Cells?: { results?: Array<{ Key?: string; Value?: string }> } }> } };
            };
          };
        };
      };
    };

    const rows =
      data?.d?.query?.PrimaryQueryResult?.RelevantResults?.Table?.Rows
        ?.results ?? [];

    for (const row of rows) {
      const cells = row.Cells?.results ?? [];
      const cellMap: Record<string, string> = {};
      for (const c of cells) {
        if (c.Key) cellMap[c.Key] = c.Value ?? '';
      }

      const title = cellMap.Title ?? '';
      const path = cellMap.Path ?? cellMap.SPSiteUrl ?? '';
      const lastModified = cellMap.LastModifiedTime ?? '';

      if (!path) continue;

      // Extract course code
      const codeMatch =
        title.match(/[A-Z]{2,4}[-\s]?\d{3,4}/i) ??
        path.match(/[a-z]{2,4}\d{3,4}/i);

      courses.push({
        title,
        url: path.startsWith('http') ? path : `https://${this.tenant}${path}`,
        path: path.startsWith('/') ? path : new URL(path).pathname,
        lastModified,
        courseCode: codeMatch ? codeMatch[0].toUpperCase() : undefined,
      });
    }

    return courses;
  }

  // ── Strategy 2: Scrape My Sites page ──────────────────

  private async scrapeMySites(page: Page): Promise<CourseSite[]> {
    const courses: CourseSite[] = [];

    // Try the SharePoint start page
    await page.goto(`https://${this.tenant}/_layouts/15/sharepoint.aspx`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    }).catch(() => {});

    await page.waitForTimeout(3000);

    // Look for site links
    const siteLinks = await page.$$eval(
      'a[href*="/sites/"]',
      (links) =>
        links.map((l) => ({
          title: (l as HTMLElement).innerText?.trim() ?? '',
          url: (l as HTMLAnchorElement).href,
        })),
    );

    for (const link of siteLinks) {
      if (!link.url || link.url.includes('/_layouts/')) continue;
      const path = new URL(link.url).pathname;
      courses.push({
        title: link.title || (path.split('/').pop() ?? ''),
        url: link.url,
        path,
      });
    }

    return courses;
  }

  // ── Strategy 3: Microsoft Graph API ───────────────────

  private async searchViaGraph(page: Page): Promise<CourseSite[]> {
    const courses: CourseSite[] = [];

    // Try to get sites via Graph (uses the same session)
    const response = await page.evaluate(async () => {
      try {
        const res = await fetch(
          'https://graph.microsoft.com/v1.0/sites?search=*&$top=500',
          {
            headers: { Accept: 'application/json' },
            credentials: 'include',
          },
        );
        return await res.json();
      } catch {
        return { value: [] };
      }
    });

    const data = response as { value?: Array<{ displayName?: string; webUrl?: string; createdDateTime?: string }> };

    for (const site of data.value ?? []) {
      if (!site.webUrl) continue;
      courses.push({
        title: site.displayName ?? '',
        url: site.webUrl,
        path: new URL(site.webUrl).pathname,
        lastModified: site.createdDateTime,
      });
    }

    return courses;
  }
}
