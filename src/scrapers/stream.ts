import type { Page } from 'playwright';
import { BaseScraper } from './base.js';
import { logger } from '../utils/logger.js';

/**
 * A single transcript entry from Stream.
 */
export interface TranscriptEntry {
  /** Timestamp (e.g., "0:00", "12:34") */
  timestamp: string;
  /** Seconds from start */
  seconds: number;
  /** Speaker name (if identified) */
  speaker?: string;
  /** Transcribed text */
  text: string;
}

/**
 * Extracts meeting transcripts from Microsoft Stream (on SharePoint).
 *
 * Opens a recording in the Stream viewer, expands the transcript
 * panel, and extracts all transcript entries with timestamps.
 *
 * ## Methods tried (in order):
 *
 * 1. Click "Transcript" button in the Stream viewer toolbar
 * 2. Look for `[data-testid="transcript-panel"]` or similar containers
 * 3. Try Microsoft Graph API transcript endpoint (requires separate auth)
 * 4. Fall back to scrolling and extracting visible entries
 *
 * ## Usage
 *
 * ```ts
 * const scraper = new StreamTranscriptScraper();
 * const result = await scraper.run({
 *   urls: [
 *     'https://...sharepoint.com/_layouts/15/stream.aspx?id=...',
 *   ],
 *   onItem: (data) => {
 *     // data.payload.entries → TranscriptEntry[]
 *     // data.payload.fullText → string (joined with timestamps)
 *   },
 * });
 * ```
 */
export class StreamTranscriptScraper extends BaseScraper {
  /**
   * Extract transcript entries from a Stream viewer page.
   */
  async extract(page: Page): Promise<Record<string, unknown>> {
    const entries: TranscriptEntry[] = [];

    try {
      // ── Step 1: Open transcript panel ─────────────────
      await this.openTranscriptPanel(page);

      // ── Step 2: Wait for transcript entries to render ──
      await this.waitForTranscriptEntries(page);

      // ── Step 3: Scroll to load all entries ────────────
      await this.scrollTranscriptPanel(page);

      // ── Step 4: Extract text ──────────────────────────
      const extracted = await this.extractTranscriptText(page);
      entries.push(...extracted);

    } catch (err) {
      logger.warn(
        `Transcript extraction via UI failed: ${(err as Error).message}. ` +
        'Trying alternative methods...',
      );

      // Try alternative: extract from page source / embedded data
      const altEntries = await this.extractFromPageSource(page);
      entries.push(...altEntries);
    }

    // Build full text (useful for RAG ingestion)
    const fullText = entries
      .map((e) => {
        const speaker = e.speaker ? `[${e.speaker}] ` : '';
        return `${e.timestamp} ${speaker}${e.text}`;
      })
      .join('\n');

    logger.info(
      `Extracted ${entries.length} transcript entries ` +
      `(${fullText.length} chars total)`,
    );

    return { entries, fullText, count: entries.length };
  }

  // ── Private: Transcript Panel Interaction ─────────────

  /**
   * Click the Transcript button to open the panel.
   * Handles multiple Stream UI versions.
   */
  private async openTranscriptPanel(page: Page): Promise<void> {
    // Wait for Stream viewer to initialize
    await page.waitForTimeout(3000);

    // Strategy 1: Transcript button (Stream on SharePoint)
    const transcriptSelectors = [
      'button[aria-label*="ranscript" i]',
      'button[title*="ranscript" i]',
      'button:has-text("Transcript")',
      'button:has-text("Transcripción")',
      '[data-testid="transcript-button"]',
      '[data-automation-id="transcriptButton"]',
      '.transcript-toggle',
      '#transcript-button',
    ];

    for (const sel of transcriptSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await btn.click();
          logger.debug(`Transcript panel opened via: ${sel}`);
          await page.waitForTimeout(1500);
          return;
        }
      } catch {
        // Try next
      }
    }

    // Strategy 2: Look for the transcript panel already visible
    const panelSelectors = [
      '[data-testid="transcript-panel"]',
      '[class*="transcript-panel" i]',
      '[class*="TranscriptPane" i]',
      '.transcript-body',
      '[aria-label*="Transcript"]',
    ];

    for (const sel of panelSelectors) {
      if (await page.locator(sel).isVisible({ timeout: 1000 }).catch(() => false)) {
        logger.debug('Transcript panel already open');
        return;
      }
    }

    logger.warn(
      'Could not find transcript button/panel. ' +
      'The recording may not have a transcript, or the UI has changed.',
    );
  }

  /**
   * Wait for transcript entries to appear in the DOM.
   */
  private async waitForTranscriptEntries(page: Page): Promise<void> {
    const entrySelectors = [
      '.transcript-entry',
      '[class*="transcript-item" i]',
      '[class*="TranscriptItem" i]',
      '.ms-StreamTranscriptItem',
      '[data-testid="transcript-entry"]',
      // Generic: any element with a timestamp pattern
    ];

    for (const sel of entrySelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 10_000, state: 'attached' });
        logger.debug(`Transcript entries found via: ${sel}`);
        return;
      } catch {
        // Try next
      }
    }

    // If no specific transcript classes found, look for timestamp patterns
    logger.warn('No transcript entry elements found — trying raw text extraction');
  }

  /**
   * Scroll the transcript panel to load all entries (lazy-loaded).
   */
  private async scrollTranscriptPanel(page: Page): Promise<void> {
    const scrollContainer = page.locator(
      '[class*="transcript"] [role="list"], ' +
      '[class*="TranscriptPane"], ' +
      '.transcript-body',
    ).first();

    if (!(await scrollContainer.isVisible().catch(() => false))) {
      return; // No scrollable container found
    }

    // Scroll to bottom in chunks to trigger lazy loading
    for (let i = 0; i < 20; i++) {
      const prevCount = await page.$$eval(
        '[class*="transcript"] > *',
        (els) => els.length,
      ).catch(() => 0);

      await scrollContainer.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      }).catch(() => {});

      await page.waitForTimeout(500);

      const newCount = await page.$$eval(
        '[class*="transcript"] > *',
        (els) => els.length,
      ).catch(() => 0);

      if (newCount === prevCount) break; // No new content loaded
    }
  }

  /**
   * Extract text from visible transcript entries.
   */
  private async extractTranscriptText(
    page: Page,
  ): Promise<TranscriptEntry[]> {
    // Try structured extraction first
    const entries = await page.$$eval(
      `
      [class*="transcript-entry" i],
      [class*="transcript-item" i],
      [class*="TranscriptItem" i],
      .ms-StreamTranscriptItem,
      li[class*="transcript"]
      `,
      (els) => {
        return els.map((el) => {
          const text = (el as HTMLElement).innerText?.trim() ?? '';
          // Try to split timestamp from text
          const match = text.match(/^([\d:]+)\s*(.*)/s);
          if (match) {
            const [, ts, txt] = match;
            const parts = ts!.split(':').map(Number);
            const seconds = (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
            return { timestamp: ts!, seconds, text: txt?.trim() ?? '' };
          }
          return {
            timestamp: '',
            seconds: 0,
            text,
          };
        });
      },
    );

    if (entries.length > 0) return entries;

    // Fallback: extract all text from the transcript panel
    const panelText = await page.$$eval(
      `
      [class*="transcript-panel" i],
      [class*="TranscriptPane" i],
      .transcript-body,
      [aria-label*="Transcript"]
      `,
      (els) => els.map((el) => (el as HTMLElement).innerText).join('\n'),
    ).catch(() => '');

    if (panelText) {
      // Parse timestamp-prefixed lines
      const lines = panelText.split('\n');
      return lines
        .map((line) => {
          const match = line.trim().match(/^([\d:]+)\s*(.*)/);
          if (match) {
            const [, ts, txt] = match;
            const parts = ts!.split(':').map(Number);
            const seconds = (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
            return {
              timestamp: ts!,
              seconds,
              text: txt?.trim() ?? '',
            };
          }
          return null;
        })
        .filter((e): e is TranscriptEntry => e !== null && e.text.length > 0);
    }

    return [];
  }

  /**
   * Try to extract transcript from embedded page data / API responses.
   */
  private async extractFromPageSource(
    page: Page,
  ): Promise<TranscriptEntry[]> {
    // Try to find transcript data in window.__DATA__ or similar
    const fromJs = await page.evaluate(() => {
      // Check common data stores
      const sources = [
        (window as unknown as Record<string, unknown>).__INITIAL_STATE__,
        (window as unknown as Record<string, unknown>).__DATA__,
        (window as unknown as Record<string, unknown>).__TRANSCRIPT__,
      ];

      for (const src of sources) {
        if (!src) continue;
        try {
          const str = JSON.stringify(src);
          // Look for transcript-like data
          if (str.includes('transcript') || str.includes('vtt')) {
            return str;
          }
        } catch {
          // Not serializable
        }
      }
      return null;
    }).catch(() => null);

    if (fromJs) {
      logger.debug('Found potential transcript data in page JS state');
      // Could parse more intelligently, but this is a hint
    }

    return [];
  }
}
