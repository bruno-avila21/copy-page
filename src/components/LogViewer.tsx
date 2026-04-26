import { useEffect, useRef } from 'react';
import type { LogEntry } from '../types.js';

interface Props {
  logs: LogEntry[];
}

const LEVEL_CLASS: Record<LogEntry['level'], string> = {
  info:  'text-text-muted',
  warn:  'text-warning',
  error: 'text-error',
};

const LEVEL_PREFIX: Record<LogEntry['level'], string> = {
  info:  '  ',
  warn:  '⚠ ',
  error: '✕ ',
};

export function LogViewer({ logs }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  return (
    <div className="card flex flex-col gap-0">
      <span className="label">Logs</span>
      <div className="bg-bg rounded-lg border border-border-subtle overflow-y-auto max-h-52 min-h-[80px] p-3 font-mono text-2xs leading-relaxed">
        {logs.length === 0 ? (
          <span className="text-text-subtle">Waiting for job to start…</span>
        ) : (
          logs.map((entry) => (
            <div key={entry.id} className={`flex gap-2 ${LEVEL_CLASS[entry.level]}`}>
              <span className="shrink-0 text-text-subtle select-none">
                {new Date(entry.timestamp).toLocaleTimeString('en', { hour12: false })}
              </span>
              <span>{LEVEL_PREFIX[entry.level]}{entry.message}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
