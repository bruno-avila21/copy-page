# DESIGN.md — CopyPage

> Design system and UX specification for CopyPage and the `@claude-agents/browser-service` skill.

---

## 1. Visual Architecture

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `bg` | `#0c0c0c` | App background |
| `bg-surface` | `#161616` | Cards, panels |
| `bg-elevated` | `#1f1f1f` | Inputs, dropdowns |
| `border` | `#2a2a2a` | Default borders |
| `border-focus` | `#6366f1` | Active input ring |
| `border-subtle` | `#1e1e1e` | Dividers, log bg |
| `text` | `#f0f0f0` | Primary text |
| `text-muted` | `#a0a0a0` | Labels, secondary info |
| `text-subtle` | `#666666` | Placeholders, hints |
| `primary` | `#6366f1` | CTA buttons, focus rings |
| `primary-hover` | `#818cf8` | Hover state |
| `gold` | `#d4a843` | Logo accent, inline code |
| `success` | `#22c55e` | Success state dot |
| `warning` | `#f59e0b` | Bot-blocked state |
| `error` | `#ef4444` | Error state |

**Design principle**: Near-black backgrounds with indigo primary and gold accents evoke a premium, focused tool. The gold references high-end packaging — deliberate restraint rather than color overload.

### Typography

| Role | Font | Weight | Size |
|------|------|--------|------|
| UI body | Inter | 400 | 14px / 1rem |
| Labels | Inter | 500 | 11px (0.75rem) + letter-spacing 0.1em |
| Headings | Inter | 600–700 | 16–24px, tracking -0.02em |
| Log/code | JetBrains Mono | 400 | 11px (0.65rem) |
| Monospace inline | JetBrains Mono | 500 | 12px |

Load both from Google Fonts (`display=swap` for no layout shift).

### Spacing & Layout

| Scale | Value | Usage |
|-------|-------|-------|
| 2xs | 4px | Tight gaps |
| xs | 8px | Default item gap |
| sm | 12px | Card inner gap |
| md | 16px | Section gap |
| lg | 24px | Card padding |
| xl | 32px | Section separation |

**Grid**: 8px base unit throughout. Cards use `p-5` (20px). Log viewer `p-3` (12px).

**Radius**: `rounded-lg` (8px) for inputs/buttons, `rounded-xl` (12px) for cards, `rounded-full` for dots.

---

## 2. Component Guide

### URL Input

```
┌─────────────────────────────────────────────────────┐
│ PAGE URL                                             │  ← label: uppercase 11px, tracking
│ ┌───────────────────────────────────────────────┐   │
│ │ https://example.com/article                   │   │  ← field: bg-elevated, border on focus
│ └───────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

- Height: 42px (`py-2.5 px-3`)
- Border: `border-border` → `border-primary` on focus + `ring-1 ring-primary/30`
- Disabled: `opacity-60 cursor-not-allowed`
- Placeholder: `text-subtle`

### Directory Input

Same as URL Input but `type="text"`. Shows OS-style path (Windows: backslashes OK).

### Wait Strategy Select

Dropdown styled as `.field`. Options: `networkidle` (default), `domcontentloaded`, `load`. Custom CSS selector can be typed directly.

### Screenshot Toggle

```
Off ─────  On (active: bg-primary/20, border-primary/50, text-primary)
```

Button acting as a switch. No separate checkbox — cleaner for a premium tool.

### CTA Button (Extract Page)

```
  ◆ Extract Page        ← gold ◆ diamond icon, indigo background
```

- Loading state: spinning ring + "Extracting…" text
- Disabled: `opacity-40`
- Active: `scale-[0.98]` press feel

### Status Badge

```
Status  ● Scraping…   ← small pulsing dot + label
```

| State | Dot | Label | Color |
|-------|-----|-------|-------|
| Idle | ● `text-subtle` | Idle | subtle |
| Loading | ● `primary` pulsing | Scraping… | primary |
| Success | ● `success` | Success | success |
| Bot Blocked | ● `warning` | Bot Blocked | warning |
| Error | ● `error` | Error | error |

### Log Viewer

```
┌─ LOGS ──────────────────────────────────────────────┐
│ 14:23:01  Opening browser…                          │  ← text-muted
│ 14:23:03  → https://example.com                     │
│ 14:23:05  ⚠ Bot challenge detected                  │  ← text-warning
│ 14:23:08  ✕ Timeout after 30000ms                   │  ← text-error
└─────────────────────────────────────────────────────┘
```

- `font-mono`, `text-2xs` (11px), line-height 1.6
- `max-h-52` (208px) with scrollbar
- Auto-scrolls to bottom on new entries
- `bg-bg` inner background (darker than card)

### Markdown Preview

Split into:
1. **Header**: title + source URL (truncated) + word count chip + duration chip + download button
2. **Path chip**: monospace path where file was saved
3. **Screenshot thumbnail**: optional, `max-h-48` cropped
4. **Markdown body**: `prose prose-invert prose-sm`, `max-h-96` scrollable

Inline code: gold color on dark bg. Links: primary indigo. Pre blocks: dark bg with border.

---

## 3. UX Flow

### State Machine

```
             ┌──────────────────────────────────────────────┐
             │                   IDLE                        │
             │  Clean form, no logs, no result shown         │
             └──────────────────┬───────────────────────────┘
                                │  User clicks "Extract Page"
                                ▼
             ┌──────────────────────────────────────────────┐
             │                 LOADING                       │
             │  • Spinner in button                          │
             │  • Log stream starts filling                  │
             │  • Form inputs disabled                       │
             │  • Status badge: "Scraping…" (pulsing dot)    │
             └──────┬───────────────────────┬───────────────┘
                    │                       │
          SSE result received          SSE error received
                    │                       │
      ┌─────────────▼────────┐   ┌──────────▼────────────────┐
      │  botDetected = false  │   │         ERROR              │
      │        SUCCESS        │   │  Red banner + error msg    │
      │  • Green dot           │   │  "Retry" button (reset)    │
      │  • Markdown preview    │   └────────────────────────────┘
      └─────────────▼─────────┘
      botDetected = true?
               │ yes
      ┌────────▼──────────────────────────────────────────────┐
      │              BOT BLOCKED                               │
      │  • Warning banner: "Content may be partial"            │
      │  • Markdown preview still shown (partial content)      │
      │  • Suggestion: "Add residential proxy"                 │
      └────────────────────────────────────────────────────────┘
```

### State Transitions

| From | Event | To |
|------|-------|----|
| Idle | Submit form | Loading |
| Loading | SSE `result` (no bot) | Success |
| Loading | SSE `result` (bot=true) | Bot Blocked |
| Loading | SSE `error` | Error |
| Any | New submit | Loading (resets logs + result) |

### Error States Detail

| Error | User message | Hint |
|-------|-------------|------|
| `net::ERR_NAME_NOT_RESOLVED` | DNS lookup failed | Check the URL |
| `Timeout 30000ms` | Page too slow | Increase timeout or try `load` |
| Bot signals in HTML | Bot challenge detected | Add proxy or session |
| `ENOENT` on outputDir | Directory not found | Create the folder first |
| Server offline | Connection refused | Run `pnpm dev:server` |

---

## 4. Consistency Guidelines

### Premium SaaS Aesthetic Principles

1. **Restraint over decoration**: No gradients on body backgrounds. Gold accent used sparingly (logo, icons only). Let whitespace breathe.

2. **Dark-first**: Designed for dark mode exclusively. Every color is chosen for dark backgrounds — don't invert.

3. **Monospace for data**: Logs, file paths, code, word counts always in JetBrains Mono. Never Inter for machine-readable content.

4. **Micro-interactions**: Button press scales to `0.98`. Dots animate with ease-in-out. New sections fade-in + slide-up. Never sudden jumps.

5. **Status is never silent**: The status badge is always visible in the header. Users never wonder "is it running?".

6. **Error honesty**: When bot detection fires, we surface the exact technical reason + a concrete mitigation. Never just "something went wrong".

7. **Path transparency**: Always show the exact file path where content was saved. Premium tools don't hide where your data went.

### Do / Don't

| Do | Don't |
|----|-------|
| Use `text-2xs` + `font-mono` for technical metadata | Use Inter for log lines |
| Use gold (`#d4a843`) for the logo/diamond icon only | Use gold for interactive elements |
| Keep card backgrounds `bg-surface` (#161616) | Use pure black (#000) for cards |
| Animate the status dot only | Animate entire UI sections |
| Show partial results on bot-block | Hide results if incomplete |

---

## 5. AgentAsync Integration

The `@claude-agents/browser-service` skill can be distributed to any project via AgentAsync.
Place the skill's `dist/` output in your project's `.claude/skills/browser-service/` or
reference it as a peer npm package.

The `SkillOutput` interface is LLM-ready: pass `output.result.markdown` directly as
context to any Claude call. The `schema` field tells Claude what to extract:

```typescript
const output = await browser.scrape({
  url: 'https://docs.example.com/api',
  schema: 'Extract all API endpoints, their methods, parameters, and descriptions',
});

// Pass to Claude:
const response = await claude.complete({
  context: output.result.markdown,
  prompt: output.schema,
});
```
