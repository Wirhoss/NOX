import type { Page, BrowserContext } from 'playwright';
import type { ExtractedData, ScrapeOptions, ScrapeResult } from '../types/index.js';
import { getBrowser, newContext, newPage, closeBrowser } from '../utils/browser.js';
import { logger } from '../utils/logger.js';
import { getConfig } from '../config.js';

/**
 * Base scraper class — extend this for site-specific extractors.
 * 
 * Usage:
 *   class MyScraper extends BaseScraper {
 *     async extract(page: Page): Promise<Record<string, unknown>> {
 *       return { title: await page.title() };
 *     }
 *   }
 *   const s = new MyScraper();
 *   const result = await s.run({ urls: ['https://example.com'] });
 */
export abstract class BaseScraper {
  /**
   * Override this: given a Page, return the data you want.
   */
  abstract extract(page: Page): Promise<Record<string, unknown>>;

  /**
   * Optional: navigate logic (default: page.goto with config timeout).
   */
  protected async navigate(page: Page, url: string): Promise<void> {
    const config = getConfig();
    await page.goto(url, {
      timeout: config.navigationTimeout,
      waitUntil: config.waitUntil,
    });
  }

  /**
   * Run the scraper against one or more URLs.
   */
  async run(options: ScrapeOptions): Promise<ScrapeResult> {
    const start = Date.now();
    const errors: Error[] = [];
    let total = 0;
    const urls = options.urls;
    const config = getConfig();

    logger.info(`Starting scrape of ${urls.length} URL(s)`);

    const browser = await getBrowser(config.headless);
    const context = await newContext(browser);
    const page = await newPage(context);

    try {
      for (const url of urls) {
        try {
          logger.info(`Navigating to: ${url}`);
          await this.navigate(page, url);

          const payload = await this.extract(page);
          const data: ExtractedData = {
            url,
            extractedAt: new Date().toISOString(),
            payload,
          };

          total++;
          await options.onItem?.(data);

          // Be polite — delay between requests
          if (config.requestDelay > 0) {
            await page.waitForTimeout(config.requestDelay);
          }
        } catch (err) {
          logger.error(`Failed on ${url}:`, err);
          errors.push(err as Error);
        }
      }
    } finally {
      await context.close();
      await closeBrowser();
    }

    const durationMs = Date.now() - start;
    logger.info(`Done. ${total} items in ${durationMs}ms, ${errors.length} errors`);
    return { total, errors, durationMs };
  }
}
