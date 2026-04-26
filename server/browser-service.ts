import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { LaunchOptions, BrowserContextOptions } from 'playwright';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

chromium.use(StealthPlugin());

const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: {} };
  Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
`;

const BOT_SIGNALS = [
  'Attention Required', 'Access denied', 'Ray ID',
  'Checking your browser', 'challenge-form', 'Just a moment',
];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
];

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
const NOISE = new Set(['script', 'style', 'noscript', 'iframe', 'svg']);
td.addRule('removeNoise', {
  filter: (node) => NOISE.has(node.nodeName.toLowerCase()),
  replacement: () => '',
});

export interface ScrapeRequest {
  url: string;
  outputDir: string;
  sessionId?: string;
  waitFor?: string;
  timeout?: number;
  screenshot?: boolean;
  proxy?: { server: string; username?: string; password?: string };
}

export interface ScrapeEvent {
  type: 'log' | 'result' | 'error';
  message?: string;
  level?: 'info' | 'warn' | 'error';
  data?: ScrapeResult;
  error?: string;
}

export interface ScrapeResult {
  url: string;
  finalUrl: string;
  title: string;
  markdown: string;
  wordCount: number;
  botDetected: boolean;
  savedTo: string;
  durationMs: number;
  screenshot?: string;
}

type Emit = (event: ScrapeEvent) => void;

function log(emit: Emit, level: 'info' | 'warn' | 'error', message: string): void {
  emit({ type: 'log', level, message });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Scroll the full page in steps to trigger lazy-loaded content.
 * Uses multiple simple evaluate calls to avoid the esbuild __name helper
 * being serialized into the browser context.
 */
async function scrollPage(page: import('playwright').Page): Promise<void> {
  const totalHeight: number = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 400; y < totalHeight; y += 400) {
    await page.evaluate((scrollY: number) => window.scrollTo(0, scrollY), y);
    await sleep(80);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * Extract clean body HTML from the live rendered DOM.
 * Removes noise elements so Turndown produces leaner Markdown.
 */
async function extractCleanHtml(page: import('playwright').Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll('script,style,noscript,iframe,template,link[rel="stylesheet"]')
      .forEach((el) => el.remove());
    return clone.innerHTML;
  });
}

export async function scrape(req: ScrapeRequest, emit: Emit): Promise<void> {
  const t0 = Date.now();
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] as string;
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      log(emit, 'info', `[${attempt + 1}/${maxRetries}] Opening browser…`);

      const launchOptions: LaunchOptions = {
        headless: true,
        args: [
          '--no-sandbox', '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
        ],
      };
      if (req.proxy) launchOptions.proxy = req.proxy;

      const contextOptions: BrowserContextOptions = {
        userAgent: ua,
        viewport: { width: 1366, height: 768 },
        locale: 'en-US',
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
        },
      };

      const sessionsDir = join(req.outputDir, '.sessions');
      const sessionPath = req.sessionId ? join(sessionsDir, `${req.sessionId}.json`) : null;

      if (sessionPath) {
        try {
          await fs.access(sessionPath);
          contextOptions.storageState = sessionPath;
          log(emit, 'info', `Session loaded: ${req.sessionId}`);
        } catch { /* no session yet */ }
      }

      const browser = await chromium.launch(launchOptions);
      try {
        const context = await browser.newContext(contextOptions);
        await context.addInitScript(STEALTH_SCRIPT);
        const page = await context.newPage();

        const waitMap: Record<string, 'networkidle' | 'domcontentloaded' | 'load'> = {
          networkidle: 'networkidle',
          domcontentloaded: 'domcontentloaded',
          load: 'load',
        };
        const waitUntil = waitMap[req.waitFor ?? 'networkidle'] ?? 'networkidle';

        log(emit, 'info', `Navigating → ${req.url}`);
        await page.goto(req.url, {
          timeout: req.timeout ?? 30_000,
          waitUntil,
        });

        if (req.waitFor && !waitMap[req.waitFor]) {
          log(emit, 'info', `Waiting for selector: ${req.waitFor}`);
          await page.waitForSelector(req.waitFor, { timeout: req.timeout ?? 30_000 });
        }

        log(emit, 'info', 'Page loaded — scrolling to reveal lazy content…');
        await scrollPage(page);
        await sleep(600);

        log(emit, 'info', 'Extracting content…');

        const html = await page.content();
        const cleanBodyHtml = await extractCleanHtml(page);
        const pageTitle = await page.title();
        const finalUrl = page.url();

        const botDetected = BOT_SIGNALS.some((s) => html.includes(s) || pageTitle.includes(s));
        if (botDetected) {
          log(emit, 'warn', '⚠ Bot challenge detected — content may be incomplete');
        }

        let screenshot: string | undefined;
        if (req.screenshot) {
          const buf = await page.screenshot({ type: 'png', fullPage: false });
          screenshot = buf.toString('base64');
        }

        if (sessionPath) {
          await fs.mkdir(sessionsDir, { recursive: true });
          await context.storageState({ path: sessionPath });
          log(emit, 'info', `Session saved: ${req.sessionId}`);
        }

        await context.close();

        // Try Readability — good for articles/blogs (high text density)
        const dom = new JSDOM(html, { url: finalUrl });
        const reader = new Readability(dom.window.document.cloneNode(true) as Document);
        const article = reader.parse();
        const articleWordCount = article ? countWords(article.textContent ?? '') : 0;

        let markdown: string;
        let title: string;
        let wordCount: number;

        // Use Readability only if it found a substantial article (≥200 words)
        if (article && articleWordCount >= 200) {
          markdown = td.turndown(article.content);
          title = article.title || pageTitle;
          wordCount = articleWordCount;
          log(emit, 'info', `Readability extracted ${wordCount} words`);
        } else {
          // Full-page extraction: use the clean body HTML from the live rendered DOM
          markdown = td.turndown(cleanBodyHtml);
          title = pageTitle;
          wordCount = countWords(markdown);
          log(emit, 'info', `Full-page extraction: ${wordCount} words`);
        }

        // Save to disk
        await fs.mkdir(req.outputDir, { recursive: true });
        const slug = finalUrl.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 80);
        const fileName = `${slug}-${Date.now()}.md`;
        const savedTo = join(req.outputDir, fileName);
        const fileContent = `# ${title}\n\n> Source: ${finalUrl}\n\n---\n\n${markdown}`;
        await fs.writeFile(savedTo, fileContent, 'utf-8');

        if (screenshot) {
          await fs.writeFile(
            join(req.outputDir, fileName.replace('.md', '.png')),
            Buffer.from(screenshot, 'base64'),
          );
        }

        const durationMs = Date.now() - t0;
        log(emit, 'info', `✓ Saved to ${savedTo} (${wordCount} words, ${durationMs}ms)`);

        const result: ScrapeResult = {
          url: req.url, finalUrl, title, markdown, wordCount,
          botDetected, savedTo, durationMs, screenshot,
        };
        emit({ type: 'result', data: result });
        return;
      } finally {
        await browser.close();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries - 1) {
        const delay = 1_000 * 2 ** attempt;
        log(emit, 'warn', `Attempt ${attempt + 1} failed: ${msg} — retrying in ${delay}ms`);
        await sleep(delay);
      } else {
        emit({ type: 'error', error: msg });
      }
    }
  }
}
