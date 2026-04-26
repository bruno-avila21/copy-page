import type { AppStatus } from '../types.js';

interface Props {
  status: AppStatus;
}

const CONFIG: Record<AppStatus, { dot: string; label: string; text: string; animate: boolean }> = {
  idle:        { dot: 'bg-text-subtle',  label: 'Idle',        text: 'text-text-subtle',  animate: false },
  loading:     { dot: 'bg-primary',      label: 'Scraping…',   text: 'text-primary',      animate: true  },
  success:     { dot: 'bg-success',      label: 'Success',     text: 'text-success',      animate: false },
  'bot-blocked': { dot: 'bg-warning',    label: 'Bot Blocked', text: 'text-warning',      animate: false },
  error:       { dot: 'bg-error',        label: 'Error',       text: 'text-error',        animate: false },
};

export function StatusBadge({ status }: Props) {
  const c = CONFIG[status];
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-text-subtle uppercase tracking-widest font-medium">Status</span>
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-block w-2 h-2 rounded-full ${c.dot} ${c.animate ? 'animate-pulse-dot' : ''}`}
        />
        <span className={`text-sm font-medium ${c.text}`}>{c.label}</span>
      </div>
    </div>
  );
}
