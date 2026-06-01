import type { Page } from 'playwright';
import { logger } from '../utils/logger.js';

/**
 * Microsoft Online (Azure AD / Office 365) login handler.
 *
 * Handles the multi-step MS login flow, including federated
 * SSO redirects (common in universities and organizations).
 *
 * Tested with: UFIDÉLITAS (ufide.ac.cr federated domain).
 *
 * ## Usage
 *
 * ```ts
 * import { microsoftLogin } from 'nox/auth/microsoft.js';
 *
 * const page = await context.newPage();
 * await microsoftLogin(page, {
 *   email: 'user@university.ac.cr',
 *   password: '...',
 * });
 * // Page is now authenticated — cookies in context
 * ```
 *
 * Or from a .nox.json config:
 *
 * ```json
 * "session": {
 *   "load": "ms-session",
 *   "save": "ms-session",
 *   "loginUrl": "https://login.microsoftonline.com",
 *   "login": [
 *     { "type": "evaluate", "value": "await microsoftLogin(page, ...)" }
 *   ]
 * }
 * ```
 */

export interface MicrosoftCredentials {
  email: string;
  password: string;
  /** Optional: initial login URL (default: MS Online) */
  loginUrl?: string;
  /** Timeout for each step (ms) */
  timeout?: number;
}

export interface MicrosoftLoginResult {
  success: boolean;
  /** Final URL after login */
  finalUrl: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Perform a full Microsoft Online login flow.
 *
 * Flow:
 *   1. Navigate to login.microsoftonline.com
 *   2. Enter email → click "Next"
 *   3. Redirect to organization's SSO page (if federated)
 *   4. Enter password → click "Sign in"
 *   5. Handle "Stay signed in?" prompt if present
 *   6. Wait for redirect back to Office/M365
 */
export async function microsoftLogin(
  page: Page,
  creds: MicrosoftCredentials,
): Promise<MicrosoftLoginResult> {
  const url = creds.loginUrl ?? 'https://login.microsoftonline.com';
  const timeout = creds.timeout ?? 15_000;

  try {
    // ── Step 1: Navigate to login page ──────────────────
    logger.info(`Microsoft login: navigating to ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout });

    // ── Step 2: Enter email ─────────────────────────────
    const emailInput = await page.waitForSelector(
      'input[type="email"], input[placeholder*="email" i], input[placeholder*="Email"]',
      { timeout, state: 'visible' },
    );
    await emailInput.fill(creds.email);
    logger.debug('Filled email');

    // Click "Next"
    await clickPrimaryButton(page, ['Next', 'Siguiente'], timeout);
    logger.debug('Clicked Next');

    // ── Step 3: Wait for password page ──────────────────
    // This may be Microsoft's own page or a federated SSO page
    const passwordInput = await page.waitForSelector(
      'input[type="password"]',
      { timeout: timeout * 2, state: 'visible' }, // SSO redirect can be slow
    );

    // Verify the email is shown (confirms we're on the right page)
    await page.waitForTimeout(500);
    const pageText = await page.innerText('body').catch(() => '');
    if (!pageText.includes(creds.email.split('@')[0].substring(0, 3))) {
      logger.warn('Email not visible on password page — proceeding anyway');
    }

    await passwordInput.fill(creds.password);
    logger.debug('Filled password');

    // Click "Sign in"
    await clickPrimaryButton(page, ['Sign in', 'Iniciar sesión'], timeout);
    logger.debug('Clicked Sign in');

    // ── Step 4: Handle "Stay signed in?" ──────────────
    const staySignedIn = await Promise.race([
      page.waitForSelector(
        'input[type="submit"], button:has-text("Yes"), button:has-text("Sí")',
        { timeout: 10_000, state: 'visible' },
      ).then(() => true).catch(() => false),
      page.waitForURL(
        (u) =>
          u.hostname.includes('office.com') ||
          u.hostname.includes('microsoft365.com') ||
          u.hostname.includes('cloud.microsoft') ||
          u.hostname.includes('sharepoint.com'),
        { timeout: 15_000 },
      ).then(() => 'redirected').catch(() => false),
    ]);

    if (staySignedIn === true) {
      logger.debug('Handling "Stay signed in?" prompt');
      await clickPrimaryButton(page, ['Yes', 'Sí'], timeout);
      // Wait for final redirect
      await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
    }

    // ── Step 5: Verify we landed successfully ──────────
    await page.waitForTimeout(1000);
    const finalUrl = page.url();

    const isOfficeApp =
      finalUrl.includes('office.com') ||
      finalUrl.includes('microsoft365.com') ||
      finalUrl.includes('cloud.microsoft') ||
      finalUrl.includes('sharepoint.com') ||
      finalUrl.includes('microsoftonline.com'); // Could have landed on apps page

    if (isOfficeApp) {
      logger.info(`Microsoft login successful → ${finalUrl}`);
    } else {
      logger.warn(`Login completed but unexpected URL: ${finalUrl}`);
    }

    return { success: true, finalUrl };
  } catch (err) {
    const msg = (err as Error).message;
    logger.error(`Microsoft login failed: ${msg}`);

    // Check for specific error indicators on the page
    const errorText = await page
      .innerText('body')
      .catch(() => '');
    const isWrongPassword =
      errorText.includes('incorrect') ||
      errorText.includes('incorrecta') ||
      errorText.includes('Wrong') ||
      errorText.includes('Invalid');

    return {
      success: false,
      finalUrl: page.url(),
      error: isWrongPassword ? 'Wrong password' : msg,
    };
  }
}

/**
 * Click the primary action button on a Microsoft login page.
 * Tries multiple strategies: input[type="submit"], button text, aria-label.
 */
async function clickPrimaryButton(
  page: Page,
  texts: string[],
  timeout: number,
): Promise<void> {
  // Strategy 1: input[type="submit"] (MS standard)
  const submitBtn = page.locator('input[type="submit"]').first();
  if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await submitBtn.click();
    return;
  }

  // Strategy 2: button with matching text
  for (const text of texts) {
    const btn = page.locator(`button:has-text("${text}")`).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click();
      return;
    }
  }

  // Strategy 3: any visible button with role="button"
  const anyBtn = page.locator('[role="button"]').first();
  if (await anyBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    logger.warn('Falling back to first role="button"');
    await anyBtn.click();
    return;
  }

  throw new Error(
    `Could not find submit button (tried: input[type="submit"], ${texts.join(', ')})`,
  );
}
