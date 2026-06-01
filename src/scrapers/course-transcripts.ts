import type { Page } from 'playwright';
import { BaseScraper } from './base.js';
import { logger } from '../utils/logger.js';

/**
 * A recording found within a course, paired with its transcript.
 */
export interface CourseRecording {
  /** Recording filename */
  name: string;
  /** Full SharePoint URL to the .mp4 */
  videoUrl: string;
  /** Date extracted from filename (YYYYMMDD) */
  date?: string;
  /** Full transcript text (if found) */
  transcriptText: string;
  /** URL to the transcript file or Stream page */
  transcriptUrl: string;
  /** How the transcript was obtained */
  transcriptSource: 'vtt_file' | 'stream_viewer' | 'graph_api' | 'none';
  /** Folder path where the recording was found */
  folderPath: string;
}

/**
 * Finds all recordings and their transcripts within a single course 
 * SharePoint site — regardless of folder structure.
 *
 * Uses SharePoint Search API to locate .mp4 files across the 
 * entire site (recursive search), then tries multiple strategies 
 * to get the transcript for each recording.
 *
 * ## Strategies for finding transcripts:
 * 1. SharePoint Search for .vtt files near the .mp4
 * 2. Stream viewer page extraction (opens transcript panel)
 * 3. Microsoft Graph API `/onlineMeetings/{id}/transcripts`
 *
 * ## Usage
 *
 * ```ts
 * const scraper = new CourseTranscriptScraper();
 * const result = await scraper.run({
 *   urls: ['https://ufidelitas.sharepoint.com/sites/sc5053fv12026bt_001'],
 *   onItem: (data) => {
 *     // One site processed
 *     for (const rec of data.payload.recordings as CourseRecording[]) {
 *       console.log(rec.date, rec.name, rec.transcriptText.length);
 *     }
 *   },
 * });
 * ```
 */
export class CourseTranscriptScraper extends BaseScraper {
  /**
   * Extract all recordings + transcripts from a course site.
   */
  async extract(page: Page): Promise<Record<string, unknown>> {
    const siteUrl = page.url();
    const sitePath = new URL(siteUrl).pathname;

    // ── Step 1: Find all .mp4 files anywhere in the site ─
    const recordings = await this.findAllRecordings(page, siteUrl);

    if (recordings.length === 0) {
      logger.warn(`No recordings found in ${sitePath}`);
      return { recordings: [], sitePath, count: 0 };
    }

    logger.info(
      `Found ${recordings.length} recording(s) in ${sitePath}`,
    );

    // ── Step 2: Try to get transcript for each ──────────
    let withTranscript = 0;
    for (const rec of recordings) {
      const transcript = await this.findTranscript(page, rec);
      rec.transcriptText = transcript.text;
      rec.transcriptUrl = transcript.url;
      rec.transcriptSource = transcript.source;

      if (transcript.text) withTranscript++;
    }

    logger.info(
      `${withTranscript}/${recordings.length} recordings have transcripts`,
    );

    const totalChars = recordings.reduce(
      (sum, r) => sum + r.transcriptText.length,
      0,
    );

    return {
      recordings,
      sitePath,
      count: recordings.length,
      withTranscript,
      totalChars,
    };
  }

  // ── Step 1: Find all recordings via SharePoint Search ──

  private async findAllRecordings(
    page: Page,
    siteUrl: string,
  ): Promise<CourseRecording[]> {
    const recordings: CourseRecording[] = [];

    try {
      // Strategy A: SharePoint Search API (recursive, ignores folder structure)
      const searchUrl =
        `${siteUrl}/_api/search/query?querytext='*.mp4'` +
        `&selectproperties='Title,Path,LastModifiedTime,ParentLink'` +
        `&rowlimit=500&sortlist='LastModifiedTime:descending'`;

      logger.debug(`Searching recordings: ${searchUrl}`);

      const response = await page.evaluate(async (url) => {
        const res = await fetch(url, {
          headers: { Accept: 'application/json;odata=verbose' },
          credentials: 'include',
        });
        return res.json();
      }, searchUrl);

      recordings.push(...this.parseRecordingSearchResults(response));

    } catch (err) {
      logger.warn(`Search API failed, falling back to crawl: ${(err as Error).message}`);
    }

    // Strategy B: Crawl document libraries (slower but works if search is broken)
    if (recordings.length === 0) {
      try {
        const crawled = await this.crawlForRecordings(page, siteUrl);
        recordings.push(...crawled);
      } catch (err) {
        logger.warn(`Crawl failed: ${(err as Error).message}`);
      }
    }

    return recordings;
  }

  private parseRecordingSearchResults(response: unknown): CourseRecording[] {
    const data = response as {
      d?: {
        query?: {
          PrimaryQueryResult?: {
            RelevantResults?: {
              RowCount?: number;
              Table?: {
                Rows?: {
                  results?: Array<{
                    Cells?: {
                      results?: Array<{ Key?: string; Value?: string }>;
                    };
                  }>;
                };
              };
            };
          };
        };
      };
    };

    const rows =
      data?.d?.query?.PrimaryQueryResult?.RelevantResults?.Table?.Rows
        ?.results ?? [];

    return rows.map((row) => {
      const cells = row.Cells?.results ?? [];
      const cellMap: Record<string, string> = {};
      for (const c of cells) {
        if (c.Key) cellMap[c.Key] = c.Value ?? '';
      }

      const name = cellMap.Title ?? '';
      const videoUrl = cellMap.Path ?? '';
      const parentLink = cellMap.ParentLink ?? '';

      return {
        name,
        videoUrl,
        date: extractDateFromFilename(name),
        transcriptText: '',
        transcriptUrl: '',
        transcriptSource: 'none' as const,
        folderPath: parentLink,
      };
    });
  }

  // ── Step 1b: Crawl fallback ───────────────────────────

  private async crawlForRecordings(
    page: Page,
    siteUrl: string,
  ): Promise<CourseRecording[]> {
    const recordings: CourseRecording[] = [];

    // Try common document library paths
    const commonPaths = [
      '/Documentos compartidos/General/Recordings/',
      '/Shared Documents/General/Recordings/',
      '/Documentos compartidos/Recordings/',
      '/Shared Documents/Recordings/',
      '/Documentos compartidos/General/',
      '/Shared Documents/General/',
    ];

    for (const path of commonPaths) {
      try {
        const url = `${siteUrl}${path}`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });

        const links = await page.$$eval(
          'a[href$=".mp4"]',
          (els) =>
            els.map((el) => ({
              name: (el as HTMLElement).innerText?.trim() ?? '',
              url: (el as HTMLAnchorElement).href,
            })),
        );

        for (const link of links) {
          if (!link.url) continue;
          recordings.push({
            name: link.name || (link.url.split('/').pop() ?? ''),
            videoUrl: link.url,
            date: extractDateFromFilename(link.name || link.url),
            transcriptText: '',
            transcriptUrl: '',
            transcriptSource: 'none',
            folderPath: path,
          });
        }

        if (recordings.length > 0) break;
      } catch {
        // Try next path
      }
    }

    return recordings;
  }

  // ── Step 2: Find transcript for a recording ───────────

  private async findTranscript(
    page: Page,
    rec: CourseRecording,
  ): Promise<{ text: string; url: string; source: CourseRecording['transcriptSource'] }> {
    // Strategy 1: Search for .vtt file in same folder
    const vttResult = await this.findVttFile(page, rec);
    if (vttResult.text) return vttResult;

    // Strategy 2: Stream viewer transcript panel
    const streamResult = await this.extractViaStream(page, rec);
    if (streamResult.text) return streamResult;

    // Strategy 3: Microsoft Graph API
    const graphResult = await this.extractViaGraph(page, rec);
    if (graphResult.text) return graphResult;

    return { text: '', url: '', source: 'none' };
  }

  // ── Strategy 1: .vtt file ─────────────────────────────

  private async findVttFile(
    page: Page,
    rec: CourseRecording,
  ): Promise<{ text: string; url: string; source: CourseRecording['transcriptSource'] }> {
    // Build expected .vtt name from .mp4 name
    const nameBase = rec.name.replace(/\.mp4$/i, '');
    const folderUrl = rec.videoUrl.substring(
      0,
      rec.videoUrl.lastIndexOf('/'),
    );

    // Try common transcript naming patterns
    const vttPatterns = [
      `${nameBase}.vtt`,
      `${nameBase}.transcript.vtt`,
      `${nameBase}_transcript.vtt`,
      `transcript.vtt`,
    ];

    for (const vttName of vttPatterns) {
      const vttUrl = `${folderUrl}/${vttName}`;
      try {
        const response = await page.evaluate(async (url) => {
          const res = await fetch(url, { credentials: 'include' });
          if (!res.ok) return null;
          return res.text();
        }, vttUrl);

        if (response) {
          const text = parseVtt(response);
          if (text.length > 50) {
            logger.debug(`Found .vtt transcript: ${vttName}`);
            return { text, url: vttUrl, source: 'vtt_file' };
          }
        }
      } catch {
        // Try next pattern
      }
    }

    return { text: '', url: '', source: 'none' };
  }

  // ── Strategy 2: Stream viewer ─────────────────────────

  private async extractViaStream(
    page: Page,
    rec: CourseRecording,
  ): Promise<{ text: string; url: string; source: CourseRecording['transcriptSource'] }> {
    // Build Stream viewer URL
    const encodedPath = encodeURIComponent(
      new URL(rec.videoUrl).pathname,
    );
    const siteUrl = rec.videoUrl.substring(
      0,
      rec.videoUrl.indexOf('/', 8),
    ); // https://tenant.sharepoint.com
    const sitePath = new URL(rec.videoUrl).pathname.match(
      /^(\/sites\/[^/]+)/,
    )?.[1] ?? '';

    const streamUrl = `${siteUrl}${sitePath}/_layouts/15/stream.aspx?id=${encodedPath}`;

    try {
      await page.goto(streamUrl, {
        waitUntil: 'networkidle',
        timeout: 30_000,
      });

      await page.waitForTimeout(4000);

      // Click transcript button
      const clicked = await this.tryClickTranscriptButton(page);
      if (!clicked) {
        return { text: '', url: streamUrl, source: 'none' };
      }

      await page.waitForTimeout(2000);

      // Extract text from transcript panel
      const text = await this.extractTranscriptText(page);

      if (text.length > 50) {
        logger.debug(`Stream transcript: ${text.length} chars`);
        return { text, url: streamUrl, source: 'stream_viewer' };
      }
    } catch (err) {
      logger.debug(`Stream extraction failed for ${rec.name}: ${(err as Error).message}`);
    }

    return { text: '', url: streamUrl, source: 'none' };
  }

  private async tryClickTranscriptButton(page: Page): Promise<boolean> {
    const selectors = [
      'button[aria-label*="ranscript" i]',
      'button:has-text("Transcript")',
      'button:has-text("Transcripción")',
      '[data-testid="transcript-button"]',
      '.transcript-toggle',
    ];

    for (const sel of selectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await btn.click();
          return true;
        }
      } catch {
        // Try next
      }
    }

    return false;
  }

  private async extractTranscriptText(page: Page): Promise<string> {
    // Try structured extraction
    const text = await page.$$eval(
      `
      [class*="transcript" i] [class*="entry" i],
      [class*="TranscriptItem" i],
      .ms-StreamTranscriptItem,
      [class*="transcript" i] [class*="item" i]
      `,
      (els) => els.map((el) => (el as HTMLElement).innerText).join('\n'),
    ).catch(() => '');

    if (text.length > 50) return text;

    // Fallback: extract entire transcript panel text
    return page.$$eval(
      `
      [class*="transcript-panel" i],
      [class*="TranscriptPane" i],
      [aria-label*="Transcript" i]
      `,
      (els) => els.map((el) => (el as HTMLElement).innerText).join('\n'),
    ).catch(() => '');
  }

  // ── Strategy 3: Microsoft Graph API ───────────────────

  private async extractViaGraph(
    _page: Page,
    rec: CourseRecording,
  ): Promise<{ text: string; url: string; source: CourseRecording['transcriptSource'] }> {
    // Graph API requires meeting ID — extract from recording metadata
    // This is a best-effort approach; the meeting ID may be in the URL metadata

    // Try the SharePoint file properties for meeting ID
    try {
      const sitePath = new URL(rec.videoUrl).pathname;
      const propsUrl =
        `https://graph.microsoft.com/v1.0/sites/ufidelitas.sharepoint.com:/${sitePath}` +
        `:/drive/root:/${encodeURIComponent(new URL(rec.videoUrl).pathname.replace(sitePath, ''))}`;

      // Graph transcript endpoint — requires specific permissions
      // Most useful when combined with app-only auth (future enhancement)
      logger.debug(
        `Graph transcript lookup for: ${rec.name} — requires app registration`,
      );

      // For now, this returns empty — requires Graph API app setup
      return { text: '', url: propsUrl, source: 'none' };
    } catch {
      return { text: '', url: '', source: 'none' };
    }
  }
}

// ── Helpers ─────────────────────────────────────────────

function extractDateFromFilename(name: string): string | undefined {
  const match = name.match(/(\d{8})_\d{6}/);
  return match ? match[1] : undefined;
}

/**
 * Parse WebVTT content into plain text (strip timestamps and metadata).
 * Preserves speaker labels if present.
 */
function parseVtt(vttContent: string): string {
  const lines = vttContent.split('\n');
  const textLines: string[] = [];
  let inHeader = true;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip header
    if (inHeader) {
      if (trimmed === 'WEBVTT' || trimmed === '') continue;
      if (/^\d+$/.test(trimmed)) {
        inHeader = false;
        continue;
      }
      continue;
    }

    // Skip cue numbers and timestamps
    if (/^\d+$/.test(trimmed)) continue;
    if (/^\d{2}:\d{2}:\d{2}\.\d{3}/.test(trimmed)) continue;

    // Skip metadata
    if (trimmed.startsWith('NOTE')) continue;
    if (trimmed.startsWith('STYLE')) continue;

    // Keep text lines
    if (trimmed) {
      // Clean speaker tags <v Speaker>text</v> → Speaker: text
      const cleaned = trimmed
        .replace(/<v\s+([^>]+)>/g, '[$1] ')
        .replace(/<\/v>/g, '')
        .replace(/<[^>]+>/g, '');
      textLines.push(cleaned);
    }
  }

  return textLines.join('\n');
}
