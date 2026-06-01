/** # UFIDÉLITAS Full RAG Pipeline
 *
 * Discovers ALL courses, then extracts ALL transcripts,
 * regardless of how each professor organizes their SharePoint site.
 *
 * ## Flow
 *   1. MS Login (session reuse)
 *   2. Discover all course sites (SharePoint Search API)
 *   3. For each course: find all .mp4 recordings (Search API)
 *   4. For each recording: extract transcript (VTT → Stream → Graph)
 *   5. Save structured output for RAG ingestion
 *
 * ## Usage
 *
 * ```bash
 * MS_EMAIL=eruiz30353@ufide.ac.cr \
 * MS_PASSWORD=*** \
 * bun run src/examples/full-rag-pipeline.ts
 * ```
 *
 * ## Output structure
 *
 * output/rag/
 * ├── courses.json                    # All discovered courses
 * ├── SC-505-Administración/
 * │   ├── 2026-01-13.txt
 * │   ├── 2026-01-20.txt
 * │   └── ...
 * ├── SC-300-BaseDeDatos/
 * │   └── ...
 * └── _summary.json                   # Per-course stats
 */

import type { Browser, Page } from 'playwright';
import {
  CourseDiscoveryScraper,
  CourseTranscriptScraper,
  type CourseSite,
  type CourseRecording,
} from '../index.js';
import { microsoftLogin } from '../auth/microsoft.js';
import { getBrowser, newContext, closeBrowser } from '../utils/browser.js';
import { sessions } from '../utils/session.js';
import { configure } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { resolve, join } from 'node:path';

// ── Config ─────────────────────────────────────────────

const CREDS = {
  email: process.env.MS_EMAIL ?? 'eruiz30353@ufide.ac.cr',
  password: process.env.MS_PASSWORD ?? '',
};

const TENANT = 'ufidelitas.sharepoint.com';
const OUTPUT_DIR = resolve(process.cwd(), 'output', 'rag');
const SESSION_NAME = 'ufide-rag';
const COURSES_CACHE = join(OUTPUT_DIR, 'courses.json');

// ── Main ───────────────────────────────────────────────

async function main() {
  configure({
    browser: { headless: true, args: ['--no-sandbox'] },
    requestDelay: 2000,
    navigationTimeout: 60_000,
  });

  mkdirSync(OUTPUT_DIR, { recursive: true });

  logger.info('=== UFIDÉLITAS Full RAG Pipeline ===\n');

  // ── 1. Authenticate ──────────────────────────────────
  logger.info('--- Step 1: Authentication ---');
  const browser = await getBrowser({
    headless: true,
    args: ['--no-sandbox'],
  });

  const context = await authenticate(browser);
  const page = await context.newPage();

  // ── 2. Discover all courses ──────────────────────────
  logger.info('--- Step 2: Course Discovery ---');

  const courses = await discoverCourses(page);

  logger.info(`\nFound ${courses.length} course(s):`);
  for (const c of courses) {
    logger.info(
      `  ${c.courseCode ?? '???'} — ${c.title.substring(0, 60)}`,
    );
  }

  // Save course list
  writeFileSync(COURSES_CACHE, JSON.stringify(courses, null, 2));
  logger.info(`\nCourse list saved: ${COURSES_CACHE}`);

  // ── 3. Extract transcripts per course ────────────────
  logger.info('\n--- Step 3: Transcript Extraction ---');

  const transcriptScraper = new CourseTranscriptScraper();
  const allRecordings: Array<{
    course: CourseSite;
    recording: CourseRecording;
  }> = [];

  for (let i = 0; i < courses.length; i++) {
    const course = courses[i]!;
    logger.info(
      `\n[${i + 1}/${courses.length}] ${course.courseCode ?? course.title.substring(0, 40)}`,
    );

    try {
      await transcriptScraper.run({
        urls: [course.url],
        onItem: (data) => {
          const recs = (data.payload.recordings as CourseRecording[]) ?? [];
          for (const rec of recs) {
            allRecordings.push({ course, recording: rec });
          }

          // Save individual transcript files
          const courseDir = join(
            OUTPUT_DIR,
            sanitizeDir(course.courseCode ?? course.title),
          );
          mkdirSync(courseDir, { recursive: true });

          for (const rec of recs) {
            if (rec.transcriptText) {
              const fileName = `${rec.date ?? 'unknown'}.txt`;
              writeFileSync(join(courseDir, fileName), rec.transcriptText);
              logger.info(
                `  Saved: ${fileName} (${rec.transcriptText.length} chars)`,
              );
            }
          }
        },
      });
    } catch (err) {
      logger.error(
        `Failed on ${course.courseCode}: ${(err as Error).message}`,
      );
    }
  }

  // ── 4. Generate summary ──────────────────────────────
  logger.info('\n--- Step 4: Summary ---');

  const summary = {
    pipeline: 'UFIDÉLITAS Full RAG Pipeline',
    generated: new Date().toISOString(),
    courses: courses.length,
    totalRecordings: allRecordings.length,
    withTranscript: allRecordings.filter(
      (r) => r.recording.transcriptText.length > 0,
    ).length,
    totalChars: allRecordings.reduce(
      (sum, r) => sum + r.recording.transcriptText.length,
      0,
    ),
  };

  writeFileSync(
    join(OUTPUT_DIR, '_summary.json'),
    JSON.stringify(summary, null, 2),
  );

  logger.info(`Courses:        ${summary.courses}`);
  logger.info(`Recordings:     ${summary.totalRecordings}`);
  logger.info(`With transcript: ${summary.withTranscript}`);
  logger.info(`Total chars:    ${summary.totalChars.toLocaleString()}`);

  // ── 5. Cleanup ───────────────────────────────────────
  await context.close();
  await closeBrowser();
  logger.info('\nPipeline complete!');
}

// ── Auth ───────────────────────────────────────────────

async function authenticate(browser: Browser) {
  const ctx = sessions.exists(SESSION_NAME)
    ? await sessions.load(browser, SESSION_NAME)
    : null;

  if (ctx) {
    logger.info('Reusing saved session');
    return ctx;
  }

  const newCtx = await newContext(browser);
  const page = await newCtx.newPage();
  const result = await microsoftLogin(page, CREDS);
  if (!result.success) throw new Error(`MS login failed: ${result.error}`);

  await sessions.save(newCtx, SESSION_NAME);
  logger.info('Login complete + session saved');
  return newCtx;
}

// ── Course Discovery ───────────────────────────────────

async function discoverCourses(page: Page): Promise<CourseSite[]> {
  // Use cache if recent (< 1 hour)
  if (existsSync(COURSES_CACHE)) {
    const stat = statSync(COURSES_CACHE);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 60 * 60 * 1000) {
      logger.info('Using cached course list (fresh)');
      return JSON.parse(readFileSync(COURSES_CACHE, 'utf-8')) as CourseSite[];
    }
  }

  const scraper = new CourseDiscoveryScraper(TENANT, '');
  let courses: CourseSite[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await scraper.run({
    urls: [`https://${TENANT}/`],
    onItem: (data) => {
      courses = (data.payload.courses as CourseSite[]) ?? [];
    },
  });

  return courses;
}

// ── Helpers ────────────────────────────────────────────

function sanitizeDir(name: string): string {
  return name.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s_-]/g, '').trim().substring(0, 60);
}

// ── Entry ──────────────────────────────────────────────

main().catch((err) => {
  logger.error('Pipeline failed:', err);
  process.exit(1);
});
