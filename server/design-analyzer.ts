import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { LaunchOptions, BrowserContextOptions } from 'playwright';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { AnalyzeResult } from '../src/types.js';

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

export interface AnalyzeRequest {
  url: string;
  outputDir: string;
  sessionId?: string;
  waitFor?: string;
  timeout?: number;
  proxy?: { server: string; username?: string; password?: string };
}

export interface AnalyzeEvent {
  type: 'log' | 'analyze-result' | 'error';
  message?: string;
  level?: 'info' | 'warn' | 'error';
  data?: AnalyzeResult;
  error?: string;
}

type Emit = (event: AnalyzeEvent) => void;

// ── token shapes ────────────────────────────────────────────────────────────

interface ColorToken {
  hex: string;
  count: number;
  usages: string[];
}

interface FontToken {
  family: string;
  sizes: string[];
  weights: string[];
}

interface HeadingToken {
  tag: string;
  size: string;
  weight: string;
  color: string;
  letterSpacing: string;
  lineHeight: string;
  fontFamily: string;
  sample: string;
}

interface ButtonToken {
  bg: string;
  color: string;
  radius: string;
  padding: string;
  fontSize: string;
  fontWeight: string;
  border: string;
}

interface SectionToken {
  tag: string;
  bg: string;
  padding: string;
}

interface DesignTokens {
  colors: ColorToken[];
  fonts: FontToken[];
  headings: HeadingToken[];
  buttons: ButtonToken[];
  shadows: string[];
  radii: string[];
  sections: SectionToken[];
  meta: { title: string; description: string; ogImage: string };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function log(emit: Emit, level: 'info' | 'warn' | 'error', message: string): void {
  emit({ type: 'log', level, message });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Scroll the full page in steps to trigger lazy-loaded content.
 * Uses separate primitive evaluate calls to avoid esbuild __name helper injection.
 */
async function scrollPage(page: import('playwright').Page): Promise<void> {
  const totalHeight: number = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 400; y < totalHeight; y += 400) {
    await page.evaluate((scrollY: number) => window.scrollTo(0, scrollY), y);
    await sleep(80);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function extractCleanHtml(page: import('playwright').Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll('script,style,noscript,iframe,template,link[rel="stylesheet"]')
      .forEach((el) => el.remove());
    return clone.innerHTML;
  });
}

// ── rgb → hex ────────────────────────────────────────────────────────────────

function rgbToHex(rgb: string): string | null {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  const r = parseInt(m[1] as string, 10);
  const g = parseInt(m[2] as string, 10);
  const b = parseInt(m[3] as string, 10);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
}

// ── token extraction (runs inside page.evaluate) ─────────────────────────────

async function extractDesignTokens(page: import('playwright').Page): Promise<DesignTokens> {
  // --- colors ---
  const rawColors = await page.evaluate(() => {
    const colorMap: Record<string, { count: number; usages: string[] }> = {};
    const els = Array.from(document.querySelectorAll('*')).slice(0, 800);
    for (const el of els) {
      const s = window.getComputedStyle(el);
      const props = [s.color, s.backgroundColor, s.borderTopColor];
      const tag = el.tagName.toLowerCase();
      for (const val of props) {
        if (!val || val === 'transparent' || val === 'rgba(0, 0, 0, 0)') continue;
        const key = val;
        if (!colorMap[key]) colorMap[key] = { count: 0, usages: [] };
        (colorMap[key] as { count: number; usages: string[] }).count += 1;
        if ((colorMap[key] as { count: number; usages: string[] }).usages.length < 3 && !((colorMap[key] as { count: number; usages: string[] }).usages.includes(tag))) {
          (colorMap[key] as { count: number; usages: string[] }).usages.push(tag);
        }
      }
    }
    return colorMap;
  });

  const colors: ColorToken[] = Object.entries(rawColors)
    .map(([rgb, data]) => {
      const hex = rgbToHex(rgb);
      return hex ? { hex, count: data.count, usages: data.usages } : null;
    })
    .filter((c): c is ColorToken => c !== null)
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // Deduplicate by hex
  const seenHex = new Set<string>();
  const dedupColors = colors.filter((c) => {
    if (seenHex.has(c.hex)) return false;
    seenHex.add(c.hex);
    return true;
  });

  // --- fonts ---
  const rawFonts = await page.evaluate(() => {
    const fontMap: Record<string, { sizes: Set<string>; weights: Set<string> }> = {};
    const els = Array.from(document.querySelectorAll('*')).slice(0, 600);
    for (const el of els) {
      const s = window.getComputedStyle(el);
      const family = s.fontFamily.split(',')[0]?.replace(/['"]/g, '').trim() ?? '';
      if (!family) continue;
      if (!fontMap[family]) fontMap[family] = { sizes: new Set(), weights: new Set() };
      (fontMap[family] as { sizes: Set<string>; weights: Set<string> }).sizes.add(s.fontSize);
      (fontMap[family] as { sizes: Set<string>; weights: Set<string> }).weights.add(s.fontWeight);
    }
    const result: Record<string, { sizes: string[]; weights: string[] }> = {};
    for (const [k, v] of Object.entries(fontMap)) {
      result[k] = { sizes: Array.from(v.sizes), weights: Array.from(v.weights) };
    }
    return result;
  });

  const fonts: FontToken[] = Object.entries(rawFonts).map(([family, data]) => ({
    family,
    sizes: data.sizes,
    weights: data.weights,
  }));

  // --- headings ---
  const headings: HeadingToken[] = await page.evaluate(() => {
    const tags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
    const result: Array<{
      tag: string; size: string; weight: string; color: string;
      letterSpacing: string; lineHeight: string; fontFamily: string; sample: string;
    }> = [];
    for (const tag of tags) {
      const el = document.querySelector(tag);
      if (!el) continue;
      const s = window.getComputedStyle(el);
      result.push({
        tag,
        size: s.fontSize,
        weight: s.fontWeight,
        color: s.color,
        letterSpacing: s.letterSpacing,
        lineHeight: s.lineHeight,
        fontFamily: s.fontFamily.split(',')[0]?.replace(/['"]/g, '').trim() ?? '',
        sample: (el.textContent ?? '').trim().slice(0, 80),
      });
    }
    return result;
  });

  // --- buttons ---
  const rawButtons = await page.evaluate(() => {
    const sel = 'button, [role="button"], a[href], input[type="submit"]';
    const els = Array.from(document.querySelectorAll(sel)).slice(0, 40);
    return els.map((el) => {
      const s = window.getComputedStyle(el);
      return {
        bg: s.backgroundColor,
        color: s.color,
        radius: s.borderRadius,
        padding: s.padding,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        border: s.border,
      };
    });
  });

  // Deduplicate buttons by bg+radius combo
  const seenBtn = new Set<string>();
  const buttons: ButtonToken[] = rawButtons.filter((b) => {
    const key = `${b.bg}|${b.radius}`;
    if (seenBtn.has(key)) return false;
    seenBtn.add(key);
    return true;
  }).slice(0, 8);

  // --- shadows ---
  const rawShadows: string[] = await page.evaluate(() => {
    const vals: string[] = [];
    const els = Array.from(document.querySelectorAll('*')).slice(0, 600);
    for (const el of els) {
      const s = window.getComputedStyle(el);
      const v = s.boxShadow;
      if (v && v !== 'none') vals.push(v);
    }
    return vals;
  });

  const seenShadow = new Set<string>();
  const shadows = rawShadows.filter((s) => {
    if (seenShadow.has(s)) return false;
    seenShadow.add(s);
    return true;
  }).slice(0, 10);

  // --- border radii ---
  const rawRadii: string[] = await page.evaluate(() => {
    const vals: string[] = [];
    const els = Array.from(document.querySelectorAll('*')).slice(0, 600);
    for (const el of els) {
      const s = window.getComputedStyle(el);
      const v = s.borderRadius;
      if (v && v !== '0px') vals.push(v);
    }
    return vals;
  });

  const seenRadius = new Set<string>();
  const radii = rawRadii.filter((r) => {
    if (seenRadius.has(r)) return false;
    seenRadius.add(r);
    return true;
  }).slice(0, 12);

  // --- sections ---
  const sections: SectionToken[] = await page.evaluate(() => {
    const tags = ['nav', 'header', 'main', 'section', 'footer'];
    const result: Array<{ tag: string; bg: string; padding: string }> = [];
    for (const tag of tags) {
      const el = document.querySelector(tag);
      if (!el) continue;
      const s = window.getComputedStyle(el);
      result.push({ tag, bg: s.backgroundColor, padding: s.padding });
    }
    return result;
  });

  // --- meta ---
  const meta = await page.evaluate(() => ({
    title: document.title,
    description:
      document.querySelector('meta[name="description"]')?.getAttribute('content') ??
      document.querySelector('meta[property="description"]')?.getAttribute('content') ?? '',
    ogImage:
      document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '',
  }));

  return {
    colors: dedupColors,
    fonts,
    headings,
    buttons,
    shadows,
    radii,
    sections,
    meta,
  };
}

// ── DESIGN.md generator ───────────────────────────────────────────────────────

function inferColorRole(hex: string, usages: string[], index: number): string {
  const h = hex.toUpperCase();
  if (h === '#FFFFFF' || h === '#FFF') return 'background / white';
  if (h === '#000000' || h === '#000') return 'black / void';
  // Very light colors → background
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  const luminance = (r * 299 + g * 114 + b * 587) / 1000;
  if (usages.some((u) => ['a', 'button'].includes(u))) return 'interactive / CTA';
  if (usages.some((u) => ['p', 'span', 'li', 'td'].includes(u))) return 'text';
  if (luminance > 200) return 'background / surface';
  if (luminance < 60) return 'text / dark surface';
  if (index === 0) return 'primary';
  if (index === 1) return 'secondary';
  return 'accent / neutral';
}

function px(val: string): string {
  return val ?? '';
}

function generateDesignMd(
  tokens: DesignTokens,
  url: string,
  screenshotPaths: { desktop?: string; tablet?: string; mobile?: string },
): string {
  const host = (() => {
    try { return new URL(url).hostname; } catch { return url; }
  })();

  // ── Section 1: Visual Theme ───────────────────────────────────────────────
  const topColors = tokens.colors.slice(0, 5);
  const hasLight = topColors.some((c) => {
    const r = parseInt(c.hex.slice(1, 3), 16);
    const g = parseInt(c.hex.slice(3, 5), 16);
    const b = parseInt(c.hex.slice(5, 7), 16);
    return (r * 299 + g * 114 + b * 587) / 1000 > 180;
  });
  const hasDark = topColors.some((c) => {
    const r = parseInt(c.hex.slice(1, 3), 16);
    const g = parseInt(c.hex.slice(3, 5), 16);
    const b = parseInt(c.hex.slice(5, 7), 16);
    return (r * 299 + g * 114 + b * 587) / 1000 < 60;
  });
  const moodLabel = hasLight && hasDark ? 'light-dominant with dark accents' :
    hasDark ? 'dark-mode dominant' : 'light / minimal';

  const primaryFont = tokens.fonts[0]?.family ?? 'system-ui';
  const heading1 = tokens.headings.find((h) => h.tag === 'h1') ?? tokens.headings[0];

  const visualTheme = `## 1. Visual Theme & Atmosphere

The design of **${host}** presents a **${moodLabel}** visual language. The dominant canvas colors are ${topColors.map((c) => `\`${c.hex}\``).join(', ')}, establishing a clear hierarchy between surfaces, text, and interactive elements.

**Key Characteristics:**
- Primary typeface: **${primaryFont}**
- ${heading1 ? `Headline treatment: ${heading1.size} / weight ${heading1.weight} with letter-spacing ${heading1.letterSpacing}` : 'Typography follows a clear size hierarchy'}
- Color palette is ${tokens.colors.length <= 6 ? 'restrained — few colors used with intent' : 'expressive — multiple tones across surfaces'}
- ${tokens.shadows.length === 0 ? 'Elevation is achieved through color contrast, not shadows' : `Elevation uses ${tokens.shadows.length} distinct shadow level(s)`}
- ${tokens.radii.length > 0 ? `Border radius vocabulary: ${tokens.radii.slice(0, 4).join(', ')}` : 'Predominantly sharp/rectangular components'}`;

  // ── Section 2: Color Palette ──────────────────────────────────────────────
  const colorTable = tokens.colors.slice(0, 16).map((c, i) => {
    const role = inferColorRole(c.hex, c.usages, i);
    const usageStr = c.usages.slice(0, 3).join(', ');
    return `| \`${c.hex}\` | ${role} | ${c.count} | ${usageStr} |`;
  }).join('\n');

  const colorPalette = `## 2. Color Palette & Roles

> Extracted from computed styles across visible elements on ${host}.

| Hex | Role | Frequency | Found On |
|-----|------|-----------|----------|
${colorTable}`;

  // ── Section 3: Typography ─────────────────────────────────────────────────
  const fontList = tokens.fonts.slice(0, 4).map((f) => {
    const sizes = [...new Set(f.sizes)].sort((a, b) => parseFloat(a) - parseFloat(b)).slice(0, 6).join(', ');
    const weights = [...new Set(f.weights)].sort().join(', ');
    return `- **${f.family}**: sizes ${sizes}; weights ${weights}`;
  }).join('\n');

  const headingTable = tokens.headings.map((h) => {
    const lh = parseFloat(h.lineHeight) > 0 && parseFloat(h.size) > 0
      ? (parseFloat(h.lineHeight) / parseFloat(h.size)).toFixed(2)
      : h.lineHeight;
    return `| ${h.tag.toUpperCase()} | ${px(h.size)} | ${h.weight} | ${lh} | ${px(h.letterSpacing)} | ${h.fontFamily} |`;
  }).join('\n');

  const typography = `## 3. Typography Rules

### Font Families

${fontList || '- system-ui, sans-serif (default)'}

### Hierarchy

| Tag | Size | Weight | Line Height | Letter Spacing | Font Family |
|-----|------|--------|-------------|----------------|-------------|
${headingTable || '| H1–H6 | (not detected) | — | — | — | — |'}

### Principles

- Body text size: ${tokens.fonts[0]?.sizes.find((s) => parseFloat(s) >= 14 && parseFloat(s) <= 18) ?? 'standard'}
- Dominant weight range: ${tokens.fonts[0]?.weights.slice(0, 3).join(', ') ?? '400, 600'}
- Letter-spacing at display sizes: ${heading1?.letterSpacing ?? 'normal'}`;

  // ── Section 4: Components ─────────────────────────────────────────────────
  const buttonsList = tokens.buttons.slice(0, 6).map((b, i) => {
    const bgHex = rgbToHex(b.bg) ?? b.bg;
    const colorHex = rgbToHex(b.color) ?? b.color;
    return `**Button variant ${i + 1}**
- Background: \`${bgHex}\`
- Text color: \`${colorHex}\`
- Border radius: \`${b.radius}\`
- Padding: \`${b.padding}\`
- Font: ${b.fontSize} / weight ${b.fontWeight}
- Border: \`${b.border}\``;
  }).join('\n\n');

  const navSection = tokens.sections.find((s) => s.tag === 'nav' || s.tag === 'header');
  const navBgHex = navSection ? (rgbToHex(navSection.bg) ?? navSection.bg) : 'not detected';

  const sectionsList = tokens.sections.map((s) => {
    const bgHex = rgbToHex(s.bg) ?? s.bg;
    return `- **\`<${s.tag}>\`**: background \`${bgHex}\`, padding \`${s.padding}\``;
  }).join('\n');

  const components = `## 4. Component Stylings

### Buttons

${buttonsList || '_(No distinct button styles detected)_'}

### Navigation

- Background: \`${navBgHex}\`
${navSection ? `- Padding: \`${navSection.padding}\`` : ''}

### Page Sections

${sectionsList || '_(No landmark sections detected)_'}`;

  // ── Section 5: Layout ─────────────────────────────────────────────────────
  const radiiTable = tokens.radii.slice(0, 8).map((r) => `| \`${r}\` | detected from computed styles |`).join('\n');

  const layout = `## 5. Layout Principles

### Spacing System

Padding values observed on landmark sections:
${tokens.sections.map((s) => `- \`<${s.tag}>\`: \`${s.padding}\``).join('\n') || '- (not detected)'}

### Border Radius Scale

| Value | Usage |
|-------|-------|
${radiiTable || '| 0 | no rounding detected |'}

### Whitespace

Inferred from section padding and button sizing — the design uses ${
    tokens.sections.some((s) => parseFloat(s.padding) > 32)
      ? 'generous vertical breathing room'
      : 'compact, efficient spacing'
  } across its layout.`;

  // ── Section 6: Depth ──────────────────────────────────────────────────────
  const shadowsTable = tokens.shadows.slice(0, 6).map((s, i) =>
    `| ${i + 1} | \`${s}\` | detected |`,
  ).join('\n');

  const depth = `## 6. Depth & Elevation

${tokens.shadows.length === 0
    ? 'No CSS box-shadows detected. Elevation is expressed through color contrast between surfaces.'
    : `| Level | Shadow | Use |
|-------|--------|-----|
${shadowsTable}`}`;

  // ── Section 7: Agent Prompt Guide ─────────────────────────────────────────
  const top8 = tokens.colors.slice(0, 8);
  const cssVarLines = top8.map((c, i) => `  --color-${i + 1}: ${c.hex}; /* ${inferColorRole(c.hex, c.usages, i)} */`).join('\n');

  const fontStack = tokens.fonts[0]
    ? `${tokens.fonts[0].family}, ${tokens.fonts[1]?.family ?? 'system-ui'}, sans-serif`
    : 'system-ui, sans-serif';

  const primaryBtn = tokens.buttons[0];
  const primaryBtnHex = primaryBtn ? (rgbToHex(primaryBtn.bg) ?? primaryBtn.bg) : tokens.colors[0]?.hex ?? '#000000';
  const primaryBtnTextHex = primaryBtn ? (rgbToHex(primaryBtn.color) ?? primaryBtn.color) : '#ffffff';

  const cardBg = tokens.sections.find((s) => s.tag === 'main' || s.tag === 'section');
  const cardBgHex = cardBg ? (rgbToHex(cardBg.bg) ?? cardBg.bg) : tokens.colors.find((c) => {
    const r = parseInt(c.hex.slice(1, 3), 16);
    const g = parseInt(c.hex.slice(3, 5), 16);
    const b = parseInt(c.hex.slice(5, 7), 16);
    return (r * 299 + g * 114 + b * 587) / 1000 > 180;
  })?.hex ?? '#ffffff';

  const cardRadius = tokens.radii[0] ?? '8px';

  const agentGuide = `## 7. Agent Prompt Guide

### CSS Variables (top 8 extracted colors)

\`\`\`css
:root {
${cssVarLines}
}
\`\`\`

### Font Stack

\`\`\`css
font-family: ${fontStack};
\`\`\`

### Ready-Made Component Prompts

- "Create a primary CTA button with background \`${primaryBtnHex}\`, text color \`${primaryBtnTextHex}\`, font size \`${primaryBtn?.fontSize ?? '16px'}\`, weight \`${primaryBtn?.fontWeight ?? '600'}\`, border-radius \`${primaryBtn?.radius ?? '6px'}\`, and padding \`${primaryBtn?.padding ?? '10px 20px'}\`."

- "Design a content card with background \`${cardBgHex}\`, border-radius \`${cardRadius}\`, padding \`24px\`${tokens.shadows[0] ? `, and box-shadow \`${tokens.shadows[0]}\`` : ', no shadow — elevation from border only'}."

- "Replicate the navigation bar with background \`${navBgHex}\`, using the font stack \`${fontStack}\`."

### Replication Tips

1. Start with the color variables block above — assign semantic roles (primary, bg, text, border, accent)
2. Set the font stack as your base body font; adjust weights to match the hierarchy table in section 3
3. Build the primary CTA button first — it establishes the interactive grammar
4. Use the border-radius values from section 5 consistently; avoid mixing grammars
5. Reproduce the section-level padding from the layout principles to recreate the spatial rhythm
6. ${tokens.shadows.length === 0 ? 'Use surface color changes (not shadows) for elevation, as the original does' : 'Apply shadows from section 6 only at the same elevation levels as the original'}`;

  // ── Screenshots reference ─────────────────────────────────────────────────
  const screenshotRef = [
    screenshotPaths.desktop ? `- Desktop (1440×900): \`${screenshotPaths.desktop}\`` : null,
    screenshotPaths.tablet ? `- Tablet (768×1024): \`${screenshotPaths.tablet}\`` : null,
    screenshotPaths.mobile ? `- Mobile (375×812): \`${screenshotPaths.mobile}\`` : null,
  ].filter(Boolean).join('\n');

  const screenshotSection = screenshotRef
    ? `\n## Screenshots\n\n${screenshotRef}\n`
    : '';

  return [
    `# Design System — ${host}\n`,
    `> Source: ${url}  \n> Title: ${tokens.meta.title}  \n> Generated: ${new Date().toISOString()}\n`,
    visualTheme,
    colorPalette,
    typography,
    components,
    layout,
    depth,
    agentGuide,
    screenshotSection,
  ].join('\n\n');
}

// ── main export ───────────────────────────────────────────────────────────────

export async function analyzeDesign(req: AnalyzeRequest, emit: Emit): Promise<void> {
  const t0 = Date.now();
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] as string;
  const maxRetries = 2;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      log(emit, 'info', `[${attempt + 1}/${maxRetries}] Opening browser for design analysis…`);

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
        viewport: { width: 1440, height: 900 },
        locale: 'en-US',
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
        },
      };

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
        await page.goto(req.url, { timeout: req.timeout ?? 30_000, waitUntil });

        log(emit, 'info', 'Page loaded — scrolling to reveal lazy content…');
        await scrollPage(page);
        await sleep(600);

        const html = await page.content();
        const pageTitle = await page.title();
        const finalUrl = page.url();

        const botDetected = BOT_SIGNALS.some((s) => html.includes(s) || pageTitle.includes(s));
        if (botDetected) {
          log(emit, 'warn', '⚠ Bot challenge detected — design tokens may be incomplete');
        }

        log(emit, 'info', 'Extracting design tokens…');
        const tokens = await extractDesignTokens(page);

        await fs.mkdir(req.outputDir, { recursive: true });
        const slug = finalUrl.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 60);
        const ts = Date.now();

        const screenshotPaths: { desktop?: string; tablet?: string; mobile?: string } = {};
        const screenshots: { desktop?: string; tablet?: string; mobile?: string } = {};

        // Desktop screenshot (already at 1440×900)
        log(emit, 'info', 'Taking desktop screenshot (1440×900)…');
        {
          const buf = await page.screenshot({ type: 'png', fullPage: false });
          const p = join(req.outputDir, `${slug}-desktop-${ts}.png`);
          await fs.writeFile(p, buf);
          screenshotPaths.desktop = p;
          screenshots.desktop = buf.toString('base64');
        }

        // Tablet screenshot
        log(emit, 'info', 'Taking tablet screenshot (768×1024)…');
        await page.setViewportSize({ width: 768, height: 1024 });
        await sleep(400);
        {
          const buf = await page.screenshot({ type: 'png', fullPage: false });
          const p = join(req.outputDir, `${slug}-tablet-${ts}.png`);
          await fs.writeFile(p, buf);
          screenshotPaths.tablet = p;
          screenshots.tablet = buf.toString('base64');
        }

        // Mobile screenshot
        log(emit, 'info', 'Taking mobile screenshot (375×812)…');
        await page.setViewportSize({ width: 375, height: 812 });
        await sleep(400);
        {
          const buf = await page.screenshot({ type: 'png', fullPage: false });
          const p = join(req.outputDir, `${slug}-mobile-${ts}.png`);
          await fs.writeFile(p, buf);
          screenshotPaths.mobile = p;
          screenshots.mobile = buf.toString('base64');
        }

        // Restore desktop for any remaining work
        await page.setViewportSize({ width: 1440, height: 900 });

        // Extract markdown (same Readability/Turndown logic as browser-service)
        log(emit, 'info', 'Extracting page content as Markdown…');
        const cleanBodyHtml = await extractCleanHtml(page);
        const dom = new JSDOM(html, { url: finalUrl });
        const reader = new Readability(dom.window.document.cloneNode(true) as Document);
        const article = reader.parse();
        const articleWordCount = article
          ? article.textContent?.split(/\s+/).filter(Boolean).length ?? 0
          : 0;

        const _markdown = article && articleWordCount >= 200
          ? td.turndown(article.content)
          : td.turndown(cleanBodyHtml);

        // Generate DESIGN.md
        log(emit, 'info', 'Generating DESIGN.md…');
        const designMd = generateDesignMd(tokens, finalUrl, screenshotPaths);
        const designMdFileName = `${slug}-DESIGN-${ts}.md`;
        const designMdPath = join(req.outputDir, designMdFileName);
        await fs.writeFile(designMdPath, designMd, 'utf-8');

        await context.close();

        const durationMs = Date.now() - t0;
        log(emit, 'info', `✓ Saved to ${designMdPath} (${durationMs}ms)`);

        const analyzeResult: AnalyzeResult = {
          url: req.url,
          finalUrl,
          title: tokens.meta.title || pageTitle,
          designMd,
          designMdPath,
          screenshots,
          screenshotPaths,
          durationMs,
          botDetected,
        };

        emit({ type: 'analyze-result', data: analyzeResult });
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
