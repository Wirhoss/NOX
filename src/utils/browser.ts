import { chromium, Browser, BrowserContext, Page } from 'playwright';
import type { BrowserConfig } from '../config.js';

/**
 * Manages Playwright browser lifecycle.
 * Supports local and remote (CDP/WebSocket) browsers.
 */

let browser: Browser | null = null;

/**
 * Launch a local Chromium browser.
 */
async function launchLocal(config: BrowserConfig): Promise<Browser> {
  return chromium.launch({
    headless: config.headless,
    ...(config.executablePath ? { executablePath: config.executablePath } : {}),
    args: config.args ?? [],
  });
}

/**
 * Connect to a remote browser via WebSocket (CDP).
 * Examples:
 *   - Browserless: ws://localhost:3000/playwright
 *   - CDP endpoint: ws://1.2.3.4:9222/devtools/browser/<id>
 */
async function connectRemote(config: BrowserConfig): Promise<Browser> {
  if (!config.wsEndpoint) {
    throw new Error('BrowserConfig.wsEndpoint is required for remote connection');
  }
  return chromium.connect(config.wsEndpoint, {
    ...(config.headers ? { headers: config.headers } : {}),
  });
}

export async function getBrowser(config: BrowserConfig): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    if (config.wsEndpoint) {
      browser = await connectRemote(config);
    } else {
      browser = await launchLocal(config);
    }
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
