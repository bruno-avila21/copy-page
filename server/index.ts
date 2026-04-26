import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { scrape, type ScrapeRequest, type ScrapeEvent } from './browser-service.js';

const app = express();
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:4173'] }));
app.use(express.json());

// Per-task event bus: taskId → emitter
// Events are buffered until the SSE client connects, then flushed.
interface TaskBus {
  emitter: EventEmitter;
  buffer: ScrapeEvent[];
  done: boolean;
}

const tasks = new Map<string, TaskBus>();

function getOrCreate(taskId: string): TaskBus {
  const existing = tasks.get(taskId);
  if (existing) return existing;
  const bus: TaskBus = { emitter: new EventEmitter(), buffer: [], done: false };
  tasks.set(taskId, bus);
  // Auto-clean 5 min after task completes
  bus.emitter.once('done', () => {
    setTimeout(() => tasks.delete(taskId), 5 * 60_000);
  });
  return bus;
}

// POST /api/scrape — starts job, returns taskId immediately
app.post('/api/scrape', (req, res) => {
  const body = req.body as ScrapeRequest;
  if (!body.url || !body.outputDir) {
    res.status(400).json({ error: 'url and outputDir are required' });
    return;
  }

  const taskId = randomUUID();
  const bus = getOrCreate(taskId);

  res.json({ taskId });

  const emit = (event: ScrapeEvent): void => {
    bus.buffer.push(event);
    bus.emitter.emit('event', event);
    if (event.type === 'result' || event.type === 'error') {
      bus.done = true;
      bus.emitter.emit('done');
    }
  };

  scrape(body, emit).catch((err: unknown) => {
    const error = err instanceof Error ? err.message : String(err);
    emit({ type: 'error', error });
  });
});

// GET /api/events/:taskId — SSE stream
app.get('/api/events/:taskId', (req, res) => {
  const { taskId } = req.params as { taskId: string };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx / proxy buffering
  res.flushHeaders();

  const send = (event: ScrapeEvent): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const bus = getOrCreate(taskId);

  // Flush already-buffered events
  for (const ev of bus.buffer) {
    send(ev);
  }

  if (bus.done) {
    res.end();
    return;
  }

  // Subscribe to future events
  const onEvent = (ev: ScrapeEvent): void => {
    // Skip events already flushed from buffer
    if (bus.buffer.includes(ev)) return;
    send(ev);
  };
  const onDone = (): void => { res.end(); };

  bus.emitter.on('event', onEvent);
  bus.emitter.once('done', onDone);

  req.on('close', () => {
    bus.emitter.off('event', onEvent);
    bus.emitter.off('done', onDone);
  });
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

const PORT = Number(process.env['PORT'] ?? 3001);
const server = app.listen(PORT, () => {
  console.log(`CopyPage server → http://localhost:${PORT}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✕ Port ${PORT} already in use.`);
    console.error(`  Kill it: Get-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess | Stop-Process -Force\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
