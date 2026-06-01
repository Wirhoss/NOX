/**
 * NOX Auth modules — reusable login handlers.
 *
 * Each module handles a specific authentication flow.
 * Import and call during your scrape setup.
 */

export { microsoftLogin } from './microsoft.js';
export type { MicrosoftCredentials, MicrosoftLoginResult } from './microsoft.js';
