import type { Page, BrowserContext } from 'playwright';
import type { ExtractedData, ScrapeOptions, ScrapeResult } from '../types/index.js';
import { getBrowser, newContext, newPage, closeBrowser } from '../utils/browser.js';
import { logger } from '../utils/logger.js';
import { getConfig, type BrowserConfig } from '../config.js';

/**
 * Base scraper class — extend this for site-specific extractors.
 */
export abstract class BaseScraper {
  abstract extract(page: Page): Promise<Record<string, unknown>>;

  protected async navigate(page: Page, url: string): Promise<void> {
    const config = getConfig();
    await page.goto(url, {
      timeout: config.navigationTimeout,
      waitUntil: config.waitUntil,
    });
  }

  async run(options: ScrapeOptions): Promise<ScrapeResult> {
    const start = Date.now();
    const errors: Error[] = [];
    let total = 0;

    const config = getConfig();
    logger.info(`Starting scrape of ${options.urls.length} URL(s)`);

    const browser = await getBrowser(config.browser);
    const context = await newContext(browser);
    const page = await newPage(context);

    try {
      for (const url of options.urls) {
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
