import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { Browser, BrowserContext } from 'playwright';
import { logger } from './logger.js';

/**
 * Playwright storage state (cookies + origins / localStorage).
 *
 * @see https://playwright.dev/docs/api/class-browsercontext#browser-context-storage-state
 */
interface StorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

/**
 * SessionManager — save/load/delete browser sessions.
 *
 * Sessions store cookies + localStorage so you can log in once
 * and reuse authentication across scrape runs.
 *
 * Sessions are saved to ~/.nox/sessions/<name>.json
 */
export class SessionManager {
  private dir: string;

  constructor(customDir?: string) {
    this.dir = customDir ?? resolve(homedir(), '.nox', 'sessions');
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  /**
   * Save the current browser context state to a named session.
   */
  async save(context: BrowserContext, name: string): Promise<string> {
    const state = await context.storageState();
    const path = this.sessionPath(name);

    writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
    logger.info(`Session saved: "${name}" → ${path}`);

    return path;
  }

  /**
   * Create a new BrowserContext with a previously saved session.
   * Returns null if the session doesn't exist.
   */
  async load(browser: Browser, name: string): Promise<BrowserContext | null> {
    const path = this.sessionPath(name);

    if (!existsSync(path)) {
      logger.warn(`Session "${name}" not found at ${path}`);
      return null;
    }

    const state: StorageState = JSON.parse(readFileSync(path, 'utf-8'));

    logger.info(`Session loaded: "${name}" (${state.cookies.length} cookies)`);

    return browser.newContext({
      storageState: state,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });
  }

  /**
   * Check if a session exists.
   */
  exists(name: string): boolean {
    return existsSync(this.sessionPath(name));
  }

  /**
   * Delete a saved session.
   */
  delete(name: string): boolean {
    const path = this.sessionPath(name);
    if (!existsSync(path)) {
      return false;
    }
    unlinkSync(path);
    logger.info(`Session deleted: "${name}"`);
    return true;
  }

  /**
   * List all saved sessions.
   */
  list(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
  }

  private sessionPath(name: string): string {
    // Sanitize: only allow alphanumeric + dash + underscore
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.dir, `${safe}.json`);
  }
}

/** Default singleton */
export const sessions = new SessionManager();
