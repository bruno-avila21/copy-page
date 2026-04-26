export type AppStatus = 'idle' | 'loading' | 'success' | 'bot-blocked' | 'error';

export interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
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

export interface ScrapeFormValues {
  url: string;
  outputDir: string;
  waitFor: string;
  timeout: number;
  screenshot: boolean;
  sessionId: string;
  mode: 'extract' | 'analyze';
}

export interface AnalyzeResult {
  url: string;
  finalUrl: string;
  title: string;
  designMd: string;
  designMdPath: string;
  screenshots: { desktop?: string; tablet?: string; mobile?: string };
  screenshotPaths: { desktop?: string; tablet?: string; mobile?: string };
  durationMs: number;
  botDetected: boolean;
}
