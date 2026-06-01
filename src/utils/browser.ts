import { chromium, Browser, BrowserContext, Page } from 'playwright';

/**
 * Manages the Playwright browser lifecycle.
 * Creates one browser instance and reuses it.
 */

let browser: Browser | null = null;

export async function getBrowser(headless = true): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless });
  }
  return browser;
}

export async function newContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
}

export async function newPage(context: BrowserContext): Promise<Page> {
  return context.newPage();
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
