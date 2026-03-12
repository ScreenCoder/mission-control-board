import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const kanbanPath = path.join(dataDir, 'kanban.json');
const port = Number(process.env.PORT || 4321);

const securityWeights = { critical: 40, warn: 15, info: 3 };

async function ensureKanbanFile() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(kanbanPath);
  } catch {
    await fs.writeFile(
      kanbanPath,
      JSON.stringify({ columns: { backlog: [], inProgress: [], blocked: [], complete: [] } }, null, 2)
    );
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function runOpenClaw(args) {
  return execFileAsync('openclaw', args, {
    cwd: path.join(__dirname, '..'),
    maxBuffer: 1024 * 1024 * 4
  }).then(({ stdout, stderr }) => ({ stdout, stderr }));
}

async function collectStatus() {
  const [healthResult, auditResult, updateResult, statusResult] = await Promise.allSettled([
    runOpenClaw(['health', '--json']),
    runOpenClaw(['security', 'audit', '--json']),
    runOpenClaw(['update', 'status']),
    runOpenClaw(['status', '--deep'])
  ]);

  const health = healthResult.status === 'fulfilled' ? JSON.parse(healthResult.value.stdout) : null;
  const audit = auditResult.status === 'fulfilled' ? JSON.parse(auditResult.value.stdout) : null;
  const updateText = updateResult.status === 'fulfilled' ? updateResult.value.stdout.trim() : 'Unavailable';
  const statusText = statusResult.status === 'fulfilled' ? statusResult.value.stdout.trim() : 'Unavailable';

  const summary = audit?.summary ?? { critical: 0, warn: 0, info: 0 };
  const penalty = Object.entries(summary).reduce((total, [key, count]) => {
    return total + (securityWeights[key] || 0) * Number(count || 0);
  }, 0);
  const securityScore = Math.max(0, 100 - penalty);

  const channels = health?.channels
    ? Object.entries(health.channels).map(([id, channel]) => ({
        id,
        configured: Boolean(channel?.configured),
        linked: Boolean(channel?.linked),
        running: Boolean(channel?.running),
        connected: Boolean(channel?.connected),
        lastError: channel?.lastError || null
      }))
    : [];

  const heartbeat = health?.heartbeatSeconds ?? null;
  const sessions = health?.sessions?.count ?? 0;
  const agentCount = Array.isArray(health?.agents) ? health.agents.length : 0;

  return {
    generatedAt: new Date().toISOString(),
    securityScore,
    securitySummary: summary,
    findings: audit?.findings ?? [],
    heartbeatSeconds: heartbeat,
    sessions,
    agentCount,
    channels,
    updateText,
    statusText,
    rawHealth: health
  };
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/status') {
    try {
      const status = await collectStatus();
      sendJson(res, 200, status);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/kanban') {
    await ensureKanbanFile();
    const data = await readJson(kanbanPath, { columns: { backlog: [], inProgress: [], blocked: [], complete: [] } });
    sendJson(res, 200, data);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/kanban') {
    await ensureKanbanFile();
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}');
        await fs.writeFile(kanbanPath, JSON.stringify(parsed, null, 2));
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
    });
    return true;
  }

  return false;
}

async function serveStatic(req, res, url) {
  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(publicDir, requestedPath));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

await ensureKanbanFile();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const handled = await handleApi(req, res, url);
  if (handled) return;
  await serveStatic(req, res, url);
});

server.listen(port, () => {
  console.log(`Mission Control listening on http://127.0.0.1:${port}`);
});
