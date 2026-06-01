import type { Page, BrowserContext, Browser } from 'playwright';
import type { ExtractedData, ScrapeOptions, ScrapeResult } from '../types/index.js';
import { getBrowser, newContext, newPage, closeBrowser } from '../utils/browser.js';
import { executeActions } from '../utils/actions.js';
import { sessions } from '../utils/session.js';
import { logger } from '../utils/logger.js';
import { getConfig } from '../config.js';

/**
 * Base scraper — extend this for custom extraction logic.
 *
 * ## Session lifecycle
 *
 * 1. If `session.load` is set → create context from saved storageState
 * 2. If no session loaded AND `session.login` is set → run login actions, then save session
 * 3. Scrape all URLs (same context = shared cookies)
 * 4. If `session.save` is set → persist storageState to disk
 * 5. Close context
 */
export abstract class BaseScraper {
  /** Override: extract data from the current page */
  abstract extract(page: Page): Promise<Record<string, unknown>>;

  /** Navigate to a URL (can be overridden for custom logic) */
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
    const browser = await getBrowser(config.browser);
    const context = await this.setupContext(browser, options);

    const page = await context.newPage();

    try {
      // Run pre-scrape actions on first URL if specified
      if (options.actions && options.actions.length > 0) {
        const firstUrl = options.urls[0];
        if (firstUrl) {
          await this.navigate(page, firstUrl);
          await executeActions(page, options.actions);
        }
      }

      for (const url of options.urls) {
        try {
          logger.info(`→ ${url}`);
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

      // Save session if requested
      if (options.session?.save) {
        await sessions.save(context, options.session.save);
      }
    } finally {
      await context.close();
      await closeBrowser();
    }

    const durationMs = Date.now() - start;
    logger.info(
      `Done. ${total} items in ${durationMs}ms, ${errors.length} errors`,
    );
    return { total, errors, durationMs };
  }

  /**
   * Set up the BrowserContext:
   * - Load saved session if requested
   * - Run login actions if needed + save the new session
   * - Fall back to a fresh context
   */
  private async setupContext(
    browser: Browser,
    options: ScrapeOptions,
  ): Promise<BrowserContext> {
    const sessionCfg = options.session;

    // 1. Try to load a saved session
    if (sessionCfg?.load) {
      const ctx = await sessions.load(browser, sessionCfg.load);
      if (ctx) return ctx;
      logger.warn(
        `Session "${sessionCfg.load}" not found, falling back to fresh context`,
      );
    }

    // 2. Fresh context
    const context = await newContext(browser);

    // 3. Run login actions if provided (and no session was loaded)
    if (sessionCfg?.login && sessionCfg.login.length > 0 && sessionCfg.loginUrl) {
      const loginPage = await context.newPage();
      try {
        logger.info(`Logging in at ${sessionCfg.loginUrl}...`);
        await loginPage.goto(sessionCfg.loginUrl, { waitUntil: 'networkidle' });
        await executeActions(loginPage, sessionCfg.login);
        logger.info('Login sequence complete');

        // Auto-save after login if a save name is configured
        if (sessionCfg.save) {
          await sessions.save(context, sessionCfg.save);
        }
      } finally {
        await loginPage.close();
      }
    }

    return context;
  }
}
