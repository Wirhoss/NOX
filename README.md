# NOX

Web data extraction with [Playwright](https://playwright.dev/) + TypeScript + [Bun](https://bun.sh/).

**Not a testing framework** — NOX uses Playwright's browser automation to scrape and extract structured data from web pages. Define your scrape jobs in JSON, validated with Joi.

## Quick Start

```bash
# Install dependencies
bun install

# Install Chromium (one-time, for local browser)
bun x playwright install chromium

# Run a scrape job from a config file
bun run scrape --config examples/hackernews.nox.json
```

## Features

- **JSON-driven**: define scrape jobs declaratively (URLs, selectors, actions)
- **Joi validation**: config files are validated at load time with clear error messages
- **Remote browsers**: connect to browserless, CDP endpoints, or any WebSocket browser
- **Session management**: persist cookies/localStorage across runs (login once, scrape forever)
- **Microsoft auth**: built-in handler for Microsoft Online / Azure AD login flows
- **Bun-native**: TypeScript runs directly, no transpilation step needed

## Project Structure

```
src/
├── index.ts              # Entry point, re-exports
├── config.ts             # Runtime config (merged from env + programmatic)
├── config/
│   ├── schema.ts         # Joi schemas + TypeScript types
│   └── loader.ts         # Load & validate .nox.json files
├── auth/
│   ├── index.ts          # Auth module barrel
│   └── microsoft.ts      # MS Online / Azure AD login handler
├── scrapers/
│   ├── base.ts           # BaseScraper — extend this
│   └── microsoft.ts      # MicrosoftScraper — auto-auth + scrape
├── types/
│   └── index.ts          # Shared type definitions
└── utils/
    ├── browser.ts        # Browser lifecycle (local + remote)
    ├── session.ts        # Session manager (save/load cookies)
    ├── actions.ts        # Action executor (click, type, wait...)
    └── logger.ts         # Timestamped logger

examples/
├── hackernews.nox.json          # Basic scraping
├── remote-browser.nox.json      # Remote browser (browserless)
├── login-session.nox.json       # Generic login + session persistence
└── microsoft-teams.nox.json     # Microsoft-authenticated scraping
```

## Config File Format

Create a `.nox.json` file:

```json
{
  "browser": {
    "headless": true
  },
  "jobs": [
    {
      "name": "my-scrape",
      "urls": ["https://example.com"],
      "actions": [
        { "type": "wait", "value": 2000 },
        { "type": "click", "selector": "#load-more" }
      ],
      "selectors": [
        {
          "name": "title",
          "selector": "h1",
          "extract": "text"
        }
      ],
      "requestDelay": 1000
    }
  ],
  "output": {
    "dir": "./output",
    "format": "json",
    "pretty": true
  }
}
```

### Remote Browser (Browserless)

```json
{
  "browser": {
    "wsEndpoint": "ws://localhost:3000/playwright",
    "headless": true
  },
  "jobs": [...]
}
```

### Selector Extract Modes

| Mode | Description |
|------|-------------|
| `text` | Inner text content |
| `html` | Inner HTML |
| `attribute` | Named attribute (requires `attribute` field) |
| `src` | `src` attribute |
| `href` | `href` attribute |
| `count` | Number of matching elements |

### Actions

| Type | Description |
|------|-------------|
| `navigate` | Go to a URL |
| `click` | Click a selector |
| `type` | Type into an input |
| `wait` | Wait N milliseconds |
| `scroll` | Scroll the page |
| `screenshot` | Take a screenshot |
| `evaluate` | Run JS in page context |

## Microsoft Online Login

NOX includes a reusable handler for Microsoft Online (Azure AD / O365) login flows — including federated SSO (common in universities).

### Standalone function

```ts
import { microsoftLogin } from 'nox/auth/microsoft.js';

const page = await context.newPage();
const result = await microsoftLogin(page, {
  email: 'user@university.ac.cr',
  password: '...',
});

if (result.success) {
  // page is now authenticated — scrape away!
  await page.goto('https://office.com/...');
}
```

### Pre-authenticated scraper

```ts
import { MicrosoftScraper } from 'nox';
import type { Page } from 'playwright';

class MyOfficeScraper extends MicrosoftScraper {
  async extract(page: Page) {
    const emails = await page.$$eval('.ms-email-item', els =>
      els.map(el => el.textContent)
    );
    return { emails };
  }
}

const scraper = new MyOfficeScraper({
  email: 'user@university.ac.cr',
  password: '...',
  sessionName: 'office-session',  // auto-saves cookies
});

// First run: logs in + saves session
// Subsequent runs: reuses saved session
const result = await scraper.run({
  urls: ['https://outlook.office.com/mail/'],
});
```

### How it works

1. Navigates to `login.microsoftonline.com`
2. Enters email → MS detects federated domain
3. Redirects to organization's SSO login page
4. Enters password → submits
5. Handles "Stay signed in?" prompt
6. Returns authenticated page

Works with: UFIDÉLITAS, UCR, UNA, TEC, and any Azure AD / O365 organization.

## Programmatic Usage

```ts
import { BaseScraper, loadConfig } from 'nox';
import type { Page } from 'playwright';

// Load & validate config
const config = loadConfig('./my-scrape.nox.json');

// Or extend BaseScraper for custom logic
class MyScraper extends BaseScraper {
  async extract(page: Page) {
    const title = await page.title();
    const count = await page.$$eval('.item', els => els.length);
    return { title, count };
  }
}

const scraper = new MyScraper();
const result = await scraper.run({
  urls: ['https://example.com'],
  onItem: (data) => console.log(data.payload),
});
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NOX_HEADLESS` | `true` | Show/hide browser window |

## License

MIT
