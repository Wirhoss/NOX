# NOX

Web data extraction with [Playwright](https://playwright.dev/) + TypeScript.

**Not a testing framework** — NOX uses Playwright's browser automation to scrape and extract data from web pages.

## Quick Start

```bash
# Install dependencies
npm install

# Install Chromium browser (one-time)
npx playwright install chromium

# Run a scrape
npm run scrape
```

## Project Structure

```
src/
├── index.ts          # Entry point
├── config.ts         # Configuration & env
├── scrapers/
│   └── base.ts       # Base scraper class — extend this
├── types/
│   └── index.ts      # Shared type definitions
└── utils/
    ├── browser.ts    # Browser lifecycle management
    └── logger.ts     # Timestamped logger
```

## Usage

Extend `BaseScraper` for your target site:

```ts
import { BaseScraper } from './scrapers/base.js';
import type { Page } from 'playwright';

class HackerNewsScraper extends BaseScraper {
  async extract(page: Page) {
    const titles = await page.$$eval('.titleline > a', els =>
      els.map(el => el.textContent)
    );
    return { titles };
  }
}

const scraper = new HackerNewsScraper();
const result = await scraper.run({
  urls: ['https://news.ycombinator.com'],
  onItem: data => console.log(data.payload),
});
```

## Configuration

Copy `.env.example` to `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `NOX_HEADLESS` | `true` | Set to `false` to see the browser |

Or configure programmatically:

```ts
import { configure } from './config.js';
configure({ headless: false, requestDelay: 2000 });
```

## License

MIT
