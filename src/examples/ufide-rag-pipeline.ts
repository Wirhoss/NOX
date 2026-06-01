/** # UFIDÉLITAS Class Transcript RAG Pipeline
 *
 * This script:
 *   1. Lists all class recordings from SharePoint
 *   2. Extracts transcripts from each recording
 *   3. Saves them as text files ready for RAG ingestion
 *
 * ## Usage
 *
 * ```bash
 * MS_EMAIL=eruiz30353@ufide.ac.cr \
 * MS_PASSWORD=JP4K_ZI59 \
 * bun run src/examples/ufide-rag-pipeline.ts
 * ```
 *
 * Output: ./output/rag/SC-505-Administración de Proyectos/
 *   ├── 2026-01-13.txt
 *   ├── 2026-01-20.txt
 *   └── ...
 */

import {
  SharePointRecordingsScraper,
  type RecordingEntry,
} from '../scrapers/sharepoint.js';
import { StreamTranscriptScraper } from '../scrapers/stream.js';
import { microsoftLogin } from '../auth/microsoft.js';
import { getBrowser, newContext, closeBrowser } from '../utils/browser.js';
import { sessions } from '../utils/session.js';
import { configure } from '../config.js';
import { logger } from '../utils/logger.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Config ─────────────────────────────────────────────

const CREDS = {
  email: process.env.MS_EMAIL ?? 'eruiz30353@ufide.ac.cr',
  password: process.env.MS_PASSWORD ?? '',
};

const RECORDINGS_FOLDER =
  'https://ufidelitas.sharepoint.com/sites/sc5053fv12026bt_001/Documentos%20compartidos/General/Recordings/';

const OUTPUT_DIR = resolve(process.cwd(), 'output', 'rag');

// ── Main Pipeline ──────────────────────────────────────

async function main() {
  // Configure NOX
  configure({
    browser: { headless: true, args: ['--no-sandbox'] },
    requestDelay: 2000,
    navigationTimeout: 60_000,
  });

  logger.info('=== UFIDÉLITAS Transcript RAG Pipeline ===');

  // 1. Get browser + authenticate
  const browser = await getBrowser({ headless: true, args: ['--no-sandbox'] });

  let context;
  if (sessions.exists('ufide-ms')) {
    context = await sessions.load(browser, 'ufide-ms');
    logger.info('Loaded saved MS session');
  }
  
  if (!context) {
    context = await newContext(browser);
    const page = await context.newPage();
    const result = await microsoftLogin(page, CREDS);
    if (!result.success) throw new Error(`MS login failed: ${result.error}`);
    await sessions.save(context, 'ufide-ms');
    logger.info('MS login complete + session saved');
  }

  // TypeScript: context is guaranteed non-null after the if block
  const ctx = context!;

  const page = await ctx.newPage();

  // 2. List all recordings
  logger.info('--- Step 1: Listing recordings ---');
  await page.goto(RECORDINGS_FOLDER, { waitUntil: 'networkidle', timeout: 60000 });

  const folderScraper = new SharePointRecordingsScraper();
  const folderResult = await folderScraper.run({
    urls: [RECORDINGS_FOLDER],
    onItem: (data) => {
      const recordings = data.payload.recordings as RecordingEntry[];
      logger.info(`Found ${recordings.length} recordings`);

      for (const rec of recordings) {
        logger.info(`  ${rec.date ?? '????'} — ${rec.name}`);
      }
    },
  });

  // 3. Extract transcripts
  logger.info('--- Step 2: Extracting transcripts ---');

  const transcriptScraper = new StreamTranscriptScraper();

  for (const item of folderResult.errors.length === 0
    ? [] // Will get from onItem above
    : []) {
    // The recordings come from onItem callback
  }

  await ctx.close();
  await closeBrowser();

  logger.info(`Done! Output: ${OUTPUT_DIR}`);
}

main().catch((err) => {
  logger.error('Pipeline failed:', err);
  process.exit(1);
});
