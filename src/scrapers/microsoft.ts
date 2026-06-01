import type { Page } from 'playwright';
import { BaseScraper } from './base.js';
import { microsoftLogin, type MicrosoftCredentials } from '../auth/microsoft.js';
import { sessions } from '../utils/session.js';
import { logger } from '../utils/logger.js';

/**
 * A scraper that auto-authenticates with Microsoft Online
 * before extracting data.
 *
 * Extends BaseScraper — just override extract().
 *
 * ## Usage
 *
 * ```ts
 * const scraper = new MicrosoftScraper({
 *   email: 'user@university.ac.cr',
 *   password: '...',
 *   sessionName: 'my-ms-session', // save/load session
 * });
 *
 * const result = await scraper.run({
 *   urls: ['https://office.com/...'],
 * });
 * ```
 */
export abstract class MicrosoftScraper extends BaseScraper {
  private creds: MicrosoftCredentials;
  private sessionName?: string;
  private loggedIn = false;

  constructor(opts: {
    email: string;
    password: string;
    /** If set, save/load session to avoid re-login */
    sessionName?: string;
  }) {
    super();
    this.creds = { email: opts.email, password: opts.password };
    this.sessionName = opts.sessionName;
  }

  abstract extract(page: Page): Promise<Record<string, unknown>>;

  /**
   * Override run() to inject MS login before scraping.
   */
  async run(options: import('../types/index.js').ScrapeOptions): Promise<import('../types/index.js').ScrapeResult> {
    // Check if we have a saved session
    if (this.sessionName && sessions.exists(this.sessionName)) {
      logger.info(`Using saved MS session: "${this.sessionName}"`);
      return super.run({
        ...options,
        session: { load: this.sessionName, save: this.sessionName },
      });
    }

    // No saved session — inject login
    logger.info('No saved session, performing Microsoft login...');
    return super.run({
      ...options,
      session: {
        save: this.sessionName,
        loginUrl: 'https://login.microsoftonline.com',
        login: [
          {
            type: 'evaluate',
            value: `await (async () => {
              const { microsoftLogin } = await import('../auth/microsoft.js');
              const result = await microsoftLogin(page, ${JSON.stringify(this.creds)});
              if (!result.success) throw new Error(result.error || 'MS login failed');
            })()`,
            delay: 0,
          },
        ],
      },
    });
  }
}
