import ReactMarkdown from 'react-markdown';
import type { ScrapeResult } from '../types.js';

interface Props {
  result: ScrapeResult;
}

export function MarkdownPreview({ result }: Props) {
  return (
    <div className="card animate-slide-up flex flex-col gap-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text truncate">{result.title}</h2>
          <a
            href={result.finalUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-text-subtle hover:text-primary truncate block transition-colors"
          >
            {result.finalUrl}
          </a>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Chip label={`${result.wordCount.toLocaleString()} words`} />
          <Chip label={`${(result.durationMs / 1000).toFixed(1)}s`} />
          {result.botDetected && (
            <Chip label="Bot challenged" className="border-warning/30 text-warning" />
          )}
          <a
            className="btn-primary text-xs py-1.5 px-3"
            href={`data:text/markdown;charset=utf-8,${encodeURIComponent(`# ${result.title}\n\n> Source: ${result.finalUrl}\n\n---\n\n${result.markdown}`)}`}
            download={`${result.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`}
          >
            ↓ Download
          </a>
        </div>
      </div>

      {/* Saved path */}
      <div className="text-2xs font-mono text-text-subtle bg-bg rounded px-2 py-1 border border-border-subtle">
        Saved → {result.savedTo}
      </div>

      {/* Screenshot */}
      {result.screenshot && (
        <img
          src={`data:image/png;base64,${result.screenshot}`}
          alt="Page screenshot"
          className="w-full rounded-lg border border-border-subtle object-cover max-h-48"
        />
      )}

      {/* Markdown content */}
      <div className="prose prose-invert prose-sm max-w-none overflow-y-auto max-h-96 pr-1
                      [&_h1]:text-text [&_h2]:text-text [&_h3]:text-text-muted
                      [&_a]:text-primary [&_code]:bg-bg [&_code]:text-gold [&_code]:px-1 [&_code]:rounded
                      [&_pre]:bg-bg [&_pre]:border [&_pre]:border-border-subtle [&_pre]:rounded-lg">
        <ReactMarkdown>{result.markdown}</ReactMarkdown>
      </div>
    </div>
  );
}

function Chip({ label, className = '' }: { label: string; className?: string }) {
  return (
    <span className={`text-2xs font-mono border border-border px-1.5 py-0.5 rounded text-text-subtle ${className}`}>
      {label}
    </span>
  );
}
