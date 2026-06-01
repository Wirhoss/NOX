/**
 * NOX Configuration
 * 
 * Load sensitive values from environment, keep defaults here.
 */

export interface NoxConfig {
  /** Base timeout for navigation (ms) */
  navigationTimeout: number;
  /** Default wait strategy */
  waitUntil: 'load' | 'domcontentloaded' | 'networkidle';
  /** Headless mode: false = show browser window */
  headless: boolean;
  /** User agent override (empty = use default) */
  userAgent: string;
  /** Request delay between actions (ms) — be polite */
  requestDelay: number;
}

export const defaultConfig: NoxConfig = {
  navigationTimeout: 30_000,
  waitUntil: 'networkidle',
  headless: process.env.NOX_HEADLESS !== 'false',
  userAgent: '',
  requestDelay: 1_000,
};

let overrides: Partial<NoxConfig> = {};

export function configure(opts: Partial<NoxConfig>): void {
  overrides = { ...overrides, ...opts };
}

export function getConfig(): NoxConfig {
  return { ...defaultConfig, ...overrides };
}
