import Joi from 'joi';

/**
 * Joi schemas for validating NOX config JSON files.
 */

// ── Browser ────────────────────────────────────────────
const browserSchema = Joi.object({
  headless: Joi.boolean().default(true),
  wsEndpoint: Joi.string().uri({ scheme: ['ws', 'wss', 'http', 'https'] }).optional(),
  headers: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
  executablePath: Joi.string().optional(),
  args: Joi.array().items(Joi.string()).optional(),
});

// ── Selector ───────────────────────────────────────────
const selectorSchema = Joi.object({
  /** Friendly name for this field */
  name: Joi.string().required(),
  /** CSS or XPath selector */
  selector: Joi.string().required(),
  /** How to extract: text | html | attribute | count */
  extract: Joi.string()
    .valid('text', 'html', 'attribute', 'src', 'href', 'count')
    .default('text'),
  /** Attribute name (used when extract = 'attribute') */
  attribute: Joi.string().when('extract', {
    is: 'attribute',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  /** Wait for this selector before extracting */
  waitFor: Joi.string().optional(),
  /** Array index filter (extract nth match, 0-based) */
  index: Joi.number().integer().min(0).optional(),
  /** Extract ALL matches into an array */
  multiple: Joi.boolean().default(false),
});

// ── Action ─────────────────────────────────────────────
const actionSchema = Joi.object({
  type: Joi.string()
    .valid('navigate', 'click', 'type', 'wait', 'scroll', 'screenshot', 'evaluate')
    .required(),
  selector: Joi.string().optional(),
  value: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
  waitFor: Joi.string().optional(),
  delay: Joi.number().integer().min(0).default(0),
});

// ── Session ────────────────────────────────────────────
const sessionSchema = Joi.object({
  /** Load a previously saved session */
  load: Joi.string().optional(),
  /** Save the session after scraping */
  save: Joi.string().optional(),
  /** Login actions to run before scraping */
  login: Joi.array().items(actionSchema).optional(),
  /** URL to navigate to before login */
  loginUrl: Joi.string().uri().optional(),
});

// ── Job (one scrape task) ──────────────────────────────
const jobSchema = Joi.object({
  name: Joi.string().required(),
  urls: Joi.array().items(Joi.string().uri()).min(1).required(),
  /** Actions to perform before extraction (on every URL) */
  actions: Joi.array().items(actionSchema).default([]),
  /** What to extract */
  selectors: Joi.array().items(selectorSchema).min(1).required(),
  /** Session config (load/save/login) */
  session: sessionSchema.optional(),
  concurrency: Joi.number().integer().min(1).default(1),
  navigationTimeout: Joi.number().integer().min(1000).optional(),
  waitUntil: Joi.string()
    .valid('load', 'domcontentloaded', 'networkidle')
    .default('networkidle'),
  requestDelay: Joi.number().integer().min(0).default(1000),
});

// ── Top-level config file schema ───────────────────────
export const noxConfigSchema = Joi.object({
  $schema: Joi.string().optional(),
  browser: browserSchema.default({}),
  jobs: Joi.array().items(jobSchema).min(1).required(),
  output: Joi.object({
    /** Output directory for results */
    dir: Joi.string().default('./output'),
    /** Output format */
    format: Joi.string().valid('json', 'csv').default('json'),
    /** Pretty-print JSON */
    pretty: Joi.boolean().default(true),
  }).default({}),
});

// ── Types (derived from schemas) ───────────────────────
export interface SelectorDef {
  name: string;
  selector: string;
  extract: 'text' | 'html' | 'attribute' | 'src' | 'href' | 'count';
  attribute?: string;
  waitFor?: string;
  index?: number;
  multiple: boolean;
}

export interface ActionDef {
  type: 'navigate' | 'click' | 'type' | 'wait' | 'scroll' | 'screenshot' | 'evaluate';
  selector?: string;
  value?: string | number;
  waitFor?: string;
  delay: number;
}

export interface JobDef {
  name: string;
  urls: string[];
  actions: ActionDef[];
  selectors: SelectorDef[];
  session?: {
    load?: string;
    save?: string;
    login?: ActionDef[];
    loginUrl?: string;
  };
  concurrency: number;
  navigationTimeout?: number;
  waitUntil: 'load' | 'domcontentloaded' | 'networkidle';
  requestDelay: number;
}

export interface NoxFileConfig {
  $schema?: string;
  browser?: {
    headless?: boolean;
    wsEndpoint?: string;
    headers?: Record<string, string>;
    executablePath?: string;
    args?: string[];
  };
  jobs: JobDef[];
  output?: {
    dir?: string;
    format?: 'json' | 'csv';
    pretty?: boolean;
  };
}
