import { useState, useCallback, useId } from 'react';
import { StatusBadge } from './components/StatusBadge.js';
import { LogViewer } from './components/LogViewer.js';
import { MarkdownPreview } from './components/MarkdownPreview.js';
import type { AppStatus, LogEntry, ScrapeResult, ScrapeFormValues } from './types.js';

// SSE must connect directly — Vite's proxy buffers streaming responses
const SERVER = import.meta.env.DEV ? 'http://localhost:3001' : '';

function randomId() {
  return Math.random().toString(36).slice(2);
}

const DEFAULT_FORM: ScrapeFormValues = {
  url: '',
  outputDir: '',
  waitFor: 'networkidle',
  timeout: 30000,
  screenshot: false,
  sessionId: '',
};

export default function App() {
  const formId = useId();
  const [form, setForm] = useState<ScrapeFormValues>(DEFAULT_FORM);
  const [status, setStatus] = useState<AppStatus>('idle');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addLog = useCallback((level: LogEntry['level'], message: string) => {
    setLogs((prev) => [
      ...prev,
      { id: randomId(), level, message, timestamp: Date.now() },
    ]);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!form.url.trim() || !form.outputDir.trim()) return;

      setStatus('loading');
      setLogs([]);
      setResult(null);
      setError(null);

      try {
        // Create task
        const res = await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: form.url.trim(),
            outputDir: form.outputDir.trim(),
            waitFor: form.waitFor || 'networkidle',
            timeout: form.timeout,
            screenshot: form.screenshot,
            sessionId: form.sessionId.trim() || undefined,
          }),
        });

        if (!res.ok) {
          const err = (await res.json()) as { error: string };
          throw new Error(err.error);
        }

        const { taskId } = (await res.json()) as { taskId: string };

        // Open SSE stream — direct to server, bypasses Vite proxy buffering
        const es = new EventSource(`${SERVER}/api/events/${taskId}`);
        // Flag: we handled termination via a message — onerror after this is just server-side res.end()
        let resolved = false;

        /** Poll /api/result once SSE closes without delivering a result. */
        const pollResult = async (): Promise<void> => {
          for (let i = 0; i < 8; i++) {
            await new Promise<void>((r) => setTimeout(r, 500 + i * 300));
            try {
              const pr = await fetch(`${SERVER}/api/result/${taskId}`);
              if (pr.status === 202) continue; // still pending
              if (!pr.ok) break;
              const payload = await pr.json() as ScrapeResult | { error: string };
              if ('error' in payload) {
                setError(payload.error);
                setStatus('error');
              } else {
                setResult(payload);
                setStatus(payload.botDetected ? 'bot-blocked' : 'success');
              }
              resolved = true;
            } catch { /* network error, keep retrying */ }
            if (resolved) break;
          }
          if (!resolved) {
            setError('Connection lost to server — make sure the server is running (pnpm dev:server)');
            setStatus('error');
          }
        };

        es.onmessage = (ev) => {
          const event = JSON.parse(ev.data as string) as {
            type: 'log' | 'result' | 'error';
            level?: LogEntry['level'];
            message?: string;
            data?: ScrapeResult;
            error?: string;
          };

          if (event.type === 'log') {
            addLog(event.level ?? 'info', event.message ?? '');
          } else if (event.type === 'result' && event.data) {
            resolved = true;
            const r = event.data;
            setResult(r);
            setStatus(r.botDetected ? 'bot-blocked' : 'success');
            es.close();
          } else if (event.type === 'error') {
            resolved = true;
            setError(event.error ?? 'Unknown error');
            setStatus('error');
            es.close();
          }
        };
        es.onerror = () => {
          // Ignore close events that fire after we already received a result/error
          if (resolved) return;
          es.close();
          // SSE closed before result arrived — fall back to polling
          void pollResult();
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus('error');
      }
    },
    [form, addLog],
  );

  const isRunning = status === 'loading';

  return (
    <div className="min-h-screen bg-bg font-sans">
      {/* Header */}
      <header className="border-b border-border-subtle px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-gold text-xl select-none">⬡</span>
          <div>
            <h1 className="text-sm font-semibold text-text leading-none">CopyPage</h1>
            <p className="text-2xs text-text-subtle mt-0.5">Extract any webpage to clean Markdown</p>
          </div>
        </div>
        <StatusBadge status={status} />
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
        {/* Input card */}
        <form id={formId} onSubmit={handleSubmit} className="card flex flex-col gap-5">
          {/* URL */}
          <div>
            <label className="label" htmlFor="url">Page URL</label>
            <input
              id="url"
              type="url"
              placeholder="https://example.com/article"
              className="field"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              required
              disabled={isRunning}
            />
          </div>

          {/* Output dir */}
          <div>
            <label className="label" htmlFor="outputDir">Save directory</label>
            <input
              id="outputDir"
              type="text"
              placeholder="C:\Users\you\Documents\pages"
              className="field"
              value={form.outputDir}
              onChange={(e) => setForm((f) => ({ ...f, outputDir: e.target.value }))}
              required
              disabled={isRunning}
            />
          </div>

          {/* Options row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="label" htmlFor="waitFor">Wait strategy</label>
              <select
                id="waitFor"
                className="field"
                value={form.waitFor}
                onChange={(e) => setForm((f) => ({ ...f, waitFor: e.target.value }))}
                disabled={isRunning}
              >
                <option value="networkidle">networkidle</option>
                <option value="domcontentloaded">domcontentloaded</option>
                <option value="load">load</option>
              </select>
            </div>

            <div>
              <label className="label" htmlFor="timeout">Timeout (ms)</label>
              <input
                id="timeout"
                type="number"
                min={5000}
                max={120000}
                step={5000}
                className="field"
                value={form.timeout}
                onChange={(e) => setForm((f) => ({ ...f, timeout: Number(e.target.value) }))}
                disabled={isRunning}
              />
            </div>

            <div>
              <label className="label" htmlFor="sessionId">Session ID</label>
              <input
                id="sessionId"
                type="text"
                placeholder="my-login"
                className="field"
                value={form.sessionId}
                onChange={(e) => setForm((f) => ({ ...f, sessionId: e.target.value }))}
                disabled={isRunning}
              />
            </div>

            <div className="flex flex-col justify-end">
              <label className="label">Screenshot</label>
              <button
                type="button"
                role="switch"
                aria-checked={form.screenshot}
                className={`h-9 px-3 rounded-lg border text-sm font-medium transition-all duration-150
                  ${form.screenshot
                    ? 'bg-primary/20 border-primary/50 text-primary'
                    : 'bg-bg-elevated border-border text-text-subtle'
                  }`}
                onClick={() => setForm((f) => ({ ...f, screenshot: !f.screenshot }))}
                disabled={isRunning}
              >
                {form.screenshot ? 'On' : 'Off'}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button type="submit" className="btn-primary self-start" disabled={isRunning}>
            {isRunning ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Extracting…
              </>
            ) : (
              <><span className="text-gold">◆</span> Extract Page</>
            )}
          </button>
        </form>

        {/* Logs */}
        {(logs.length > 0 || isRunning) && <LogViewer logs={logs} />}

        {/* Error state */}
        {status === 'error' && error && (
          <div className="card border-error/30 animate-fade-in">
            <p className="text-xs font-medium text-error mb-1">Extraction failed</p>
            <p className="text-sm text-text-muted font-mono">{error}</p>
            <p className="text-xs text-text-subtle mt-3">
              If you see &quot;Bot challenge&quot; in the logs, try adding a proxy or
              increasing the timeout. See DESIGN.md for mitigation strategies.
            </p>
          </div>
        )}

        {/* Bot-blocked banner */}
        {status === 'bot-blocked' && result && (
          <div className="card border-warning/30 animate-fade-in">
            <p className="text-xs font-medium text-warning mb-1">
              ⚠ Bot detection triggered — content may be partial
            </p>
            <p className="text-xs text-text-subtle">
              The page likely uses Cloudflare or a similar service. Add a residential
              proxy via the Session ID field or contact the site owner.
            </p>
          </div>
        )}

        {/* Result preview */}
        {result && <MarkdownPreview result={result} />}
      </main>
    </div>
  );
}
