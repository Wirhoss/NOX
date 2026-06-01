/// <reference types="node" />

/**
 * NOX — Web data extraction with Playwright + TypeScript + Bun
 *
 * Uses Playwright's browser automation to extract structured
 * data from web pages. Configured via JSON + Joi validation.
 */

// Config
export { configure, getConfig } from './config.js';
export type { NoxConfig, BrowserConfig } from './config.js';

// Config loader & schema
export { loadConfig, tryLoadConfig, ConfigError } from './config/loader.js';
export { noxConfigSchema } from './config/schema.js';
export type {
  NoxFileConfig,
  JobDef,
  SelectorDef,
  ActionDef,
} from './config/schema.js';

// Types
export type {
  ExtractedData,
  ScrapeOptions,
  ScrapeResult,
  SessionConfig,
} from './types/index.js';

// Scrapers
export { BaseScraper } from './scrapers/base.js';

// Session management
export { SessionManager, sessions } from './utils/session.js';

// Actions
export { executeActions } from './utils/actions.js';

// Auth modules
export { microsoftLogin } from './auth/microsoft.js';
export type { MicrosoftCredentials, MicrosoftLoginResult } from './auth/microsoft.js';

// Pre-authenticated scrapers
export { MicrosoftScraper } from './scrapers/microsoft.js';

// SharePoint & Stream scrapers
export { SharePointRecordingsScraper } from './scrapers/sharepoint.js';
export type { RecordingEntry } from './scrapers/sharepoint.js';
export { StreamTranscriptScraper } from './scrapers/stream.js';
export type { TranscriptEntry } from './scrapers/stream.js';

// Course discovery & transcript scrapers
export { CourseDiscoveryScraper } from './scrapers/course-discovery.js';
export type { CourseSite } from './scrapers/course-discovery.js';
export { CourseTranscriptScraper } from './scrapers/course-transcripts.js';
export type { CourseRecording } from './scrapers/course-transcripts.js';
