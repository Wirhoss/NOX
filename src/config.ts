/**
 * NOX Configuration
 *
 * Programmatic config (merged with env vars and JSON).
 */

export interface BrowserConfig {
  /** Headless mode: false = show browser window */
  headless: boolean;
  /** WebSocket endpoint for remote browser (browserless, CDP, etc.) */
  wsEndpoint?: string;
  /** Custom headers for WebSocket handshake (e.g., auth tokens) */
  headers?: Record<string, string>;
  /** Custom Chromium executable path (local only) */
  executablePath?: string;
  /** Extra Chromium launch args (local only) */
  args?: string[];
}

export interface NoxConfig {
  /** Browser configuration */
  browser: BrowserConfig;
  /** Default timeout for navigation (ms) */
  navigationTimeout: number;
  /** Default wait strategy */
  waitUntil: 'load' | 'domcontentloaded' | 'networkidle';
  /** Request delay between actions (ms) — be polite */
  requestDelay: number;
}

export const defaultConfig: NoxConfig = {
  browser: {
    headless: process.env.NOX_HEADLESS !== 'false',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
  navigationTimeout: 30_000,
  waitUntil: 'networkidle',
  requestDelay: 1_000,
};

let overrides: Partial<NoxConfig> = {};

export function configure(opts: Partial<NoxConfig>): void {
  overrides = {
    ...overrides,
    ...opts,
    browser: opts.browser
      ? { ...overrides.browser, ...opts.browser }
      : overrides.browser,
  };
}

export function getConfig(): NoxConfig {
  return deepMerge(defaultConfig, overrides);
}

function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const ov = override[key];
    const bv = base[key];
    if (
      ov !== undefined &&
      bv !== undefined &&
      typeof ov === 'object' &&
      ov !== null &&
      !Array.isArray(ov) &&
      typeof bv === 'object' &&
      bv !== null &&
      !Array.isArray(bv)
    ) {
      (result as Record<string, unknown>)[key as string] = deepMerge(
        bv as object,
        ov as object,
      );
    } else if (ov !== undefined) {
      (result as Record<string, unknown>)[key as string] = ov;
    }
  }
  return result;
}
