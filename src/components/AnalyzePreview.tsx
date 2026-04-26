import ReactMarkdown from 'react-markdown';
import type { AnalyzeResult } from '../types.js';

interface Props {
  result: AnalyzeResult;
}

export function AnalyzePreview({ result }: Props) {
  const mdBlob = new Blob([result.designMd], { type: 'text/markdown' });
  const mdUrl = URL.createObjectURL(mdBlob);

  const fileName = result.title
    ? `${result.title.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 60)}-DESIGN.md`
    : 'DESIGN.md';

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
          <Chip label={`${(result.durationMs / 1000).toFixed(1)}s`} />
          {result.botDetected && (
            <Chip label="Bot challenged" className="border-warning/30 text-warning" />
          )}
          <a
            className="btn-primary text-xs py-1.5 px-3"
            href={mdUrl}
            download={fileName}
          >
            ↓ Download DESIGN.md
          </a>
        </div>
      </div>

      {/* Saved path */}
      <div className="text-2xs font-mono text-text-subtle bg-bg rounded px-2 py-1 border border-border-subtle">
        Saved → {result.designMdPath}
      </div>

      {/* Screenshots */}
      {(result.screenshots.desktop ?? result.screenshots.tablet ?? result.screenshots.mobile) && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-text-muted">Screenshots</p>
          <div className="grid grid-cols-3 gap-2">
            {result.screenshots.desktop && (
              <ScreenshotThumb
                src={result.screenshots.desktop}
                label="Desktop 1440×900"
                path={result.screenshotPaths.desktop}
              />
            )}
            {result.screenshots.tablet && (
              <ScreenshotThumb
                src={result.screenshots.tablet}
                label="Tablet 768×1024"
                path={result.screenshotPaths.tablet}
              />
            )}
            {result.screenshots.mobile && (
              <ScreenshotThumb
                src={result.screenshots.mobile}
                label="Mobile 375×812"
                path={result.screenshotPaths.mobile}
              />
            )}
          </div>
        </div>
      )}

      {/* DESIGN.md rendered */}
      <div className="prose prose-invert prose-sm max-w-none overflow-y-auto max-h-[32rem] pr-1
                      [&_h1]:text-text [&_h2]:text-text [&_h3]:text-text-muted
                      [&_h4]:text-text-muted [&_h5]:text-text-muted [&_h6]:text-text-muted
                      [&_a]:text-primary [&_code]:bg-bg [&_code]:text-gold [&_code]:px-1 [&_code]:rounded
                      [&_pre]:bg-bg [&_pre]:border [&_pre]:border-border-subtle [&_pre]:rounded-lg
                      [&_table]:text-xs [&_th]:text-text-subtle [&_td]:text-text-muted
                      [&_blockquote]:border-l-border [&_blockquote]:text-text-subtle">
        <ReactMarkdown>{result.designMd}</ReactMarkdown>
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

function ScreenshotThumb({
  src,
  label,
  path,
}: {
  src: string;
  label: string;
  path?: string;
}) {
  const imgSrc = `data:image/png;base64,${src}`;
  const blob = dataUriToBlob(imgSrc);
  const dlUrl = URL.createObjectURL(blob);
  const dlName = path
    ? path.split(/[\\/]/).pop() ?? 'screenshot.png'
    : 'screenshot.png';

  return (
    <div className="flex flex-col gap-1">
      <a href={dlUrl} download={dlName} title={`Download ${label}`}>
        <img
          src={imgSrc}
          alt={label}
          className="w-full rounded-lg border border-border-subtle object-cover max-h-32 hover:opacity-80 transition-opacity"
        />
      </a>
      <p className="text-2xs text-text-subtle text-center truncate">{label}</p>
      {path && (
        <p className="text-2xs font-mono text-text-subtle truncate text-center" title={path}>
          {path.split(/[\\/]/).pop()}
        </p>
      )}
    </div>
  );
}

function dataUriToBlob(dataUri: string): Blob {
  const [header, data] = dataUri.split(',') as [string, string];
  const mime = (header.match(/:(.*?);/) ?? [])[1] ?? 'image/png';
  const byteString = atob(data);
  const ab = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    ab[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mime });
}
