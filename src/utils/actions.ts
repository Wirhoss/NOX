import type { Page } from 'playwright';
import type { ActionDef } from '../config/schema.js';
import { logger } from './logger.js';

/**
 * Execute a list of Playwright actions on a page.
 *
 * Used for login flows and pre-scrape actions.
 */
export async function executeActions(
  page: Page,
  actions: ActionDef[],
): Promise<void> {
  for (const action of actions) {
    logger.debug(`Action: ${action.type}`, action.selector ?? action.value ?? '');

    switch (action.type) {
      case 'navigate':
        if (action.value) {
          await page.goto(String(action.value), { waitUntil: 'networkidle' });
        }
        break;

      case 'click':
        if (action.selector) {
          if (action.waitFor) {
            await page.waitForSelector(action.waitFor, { state: 'visible' });
          }
          await page.click(action.selector);
        }
        break;

      case 'type':
        if (action.selector && action.value !== undefined) {
          await page.fill(action.selector, String(action.value));
        }
        break;

      case 'wait':
        await page.waitForTimeout(Number(action.value) || action.delay || 1000);
        break;

      case 'scroll':
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        break;

      case 'screenshot':
        await page.screenshot({ path: `./output/screenshot-${Date.now()}.png` });
        break;

      case 'evaluate':
        if (action.value) {
          // eslint-disable-next-line no-eval
          await page.evaluate(String(action.value));
        }
        break;

      default:
        logger.warn(`Unknown action type: ${(action as { type: string }).type}`);
    }

    // Delay between actions
    if (action.delay > 0) {
      await page.waitForTimeout(action.delay);
    }
  }
}
