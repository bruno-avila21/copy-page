import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { scrape, type ScrapeRequest, type ScrapeEvent } from './browser-service.js';

const app = express();
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:4173'] }));
app.use(express.json());

interface TaskBus {
  emitter: EventEmitter;
  /** Events emitted before an SSE client connected — flushed on connect */
  preBuffer: ScrapeEvent[];
  /** True once an SSE client has connected — new events go directly to emitter */
  sseConnected: boolean;
  done: boolean;
}

const tasks = new Map<string, TaskBus>();

function getOrCreate(taskId: string): TaskBus {
  const existing = tasks.get(taskId);
  if (existing) return existing;
  const bus: TaskBus = {
    emitter: new EventEmitter(),
    preBuffer: [],
    sseConnected: false,
    done: false,
  };
  tasks.set(taskId, bus);
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
    if (!bus.sseConnected) {
      // SSE client not yet connected — buffer the event
      bus.preBuffer.push(event);
    }
    // Always emit so live SSE listeners receive it
    bus.emitter.emit('event', event);
    if (event.type === 'result' || event.type === 'error') {
      bus.done = true;
      bus.emitter.emit('done');
    }
  };

  scrape(body, emit).catch((err: unknown) => {
    emit({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  });
});

// GET /api/events/:taskId — SSE stream
app.get('/api/events/:taskId', (req, res) => {
  const { taskId } = req.params as { taskId: string };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event: ScrapeEvent): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const bus = getOrCreate(taskId);

  // Flush events that arrived before this SSE connection
  for (const ev of bus.preBuffer) {
    send(ev);
  }
  bus.sseConnected = true;

  // If already done, all events were flushed above — client will close on its own
  if (bus.done) return;

  // Forward live events directly — no buffer check needed
  const onEvent = (ev: ScrapeEvent): void => { send(ev); };

  bus.emitter.on('event', onEvent);

  // Never call res.end() from the server — the client calls es.close() after
  // receiving result/error, which closes the TCP connection cleanly.
  // This prevents the FIN arriving before onmessage fires in the browser.
  req.on('close', () => {
    bus.emitter.off('event', onEvent);
  });
});

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
    console.error(`  Fix: Get-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess | Stop-Process -Force\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
