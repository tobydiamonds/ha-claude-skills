const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
const cron = require('node-cron');
const markdownIt = require('markdown-it');
const puppeteer = require('puppeteer-core');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const md = markdownIt({ html: true, linkify: true });

const RUNS_DIR = '/data/runs';
const SKILLS_DIR = '/data/skills';
const SHARE_DIR = '/share/madplaner';
const OPTIONS_PATH = '/data/options.json';
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;

app.use(express.json());
app.use('/pdf', express.static(SHARE_DIR));
app.use(express.static(path.join(__dirname, 'public')));

const scheduledJobs = new Map();
const activeRuns = new Map();

// --- Options ---

function getOptions() {
  if (fs.existsSync(OPTIONS_PATH)) {
    return JSON.parse(fs.readFileSync(OPTIONS_PATH, 'utf8'));
  }
  return {};
}

// --- Madplaner ---

function listMadplaner() {
  if (!fs.existsSync(SHARE_DIR)) return [];
  return fs.readdirSync(SHARE_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const name = f.replace('.md', '');
      const mdPath = path.join(SHARE_DIR, f);
      const pdfPath = path.join(SHARE_DIR, name + '.pdf');
      const stat = fs.statSync(mdPath);
      const match = name.match(/uge-(\d+)-(\d+)/);
      return {
        id: name,
        file: f,
        week: match ? parseInt(match[1]) : null,
        year: match ? parseInt(match[2]) : null,
        hasPdf: fs.existsSync(pdfPath),
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getMadplanHtml(id) {
  const mdPath = path.join(SHARE_DIR, id + '.md');
  if (!fs.existsSync(mdPath)) return null;
  const content = fs.readFileSync(mdPath, 'utf8');
  return md.render(content);
}

// --- PDF Generation ---

async function generatePdf(mdFilePath) {
  const content = fs.readFileSync(mdFilePath, 'utf8');
  const html = renderFullHtml(md.render(content));
  const pdfPath = mdFilePath.replace('.md', '.pdf');

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    printBackground: true,
  });

  await browser.close();
  return pdfPath;
}

function renderFullHtml(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #222; max-width: 800px; margin: 0 auto; padding: 20px; }
  h1 { color: #e94560; border-bottom: 2px solid #e94560; padding-bottom: 0.3em; }
  h2 { color: #16213e; margin-top: 2em; page-break-before: always; }
  h2:first-of-type { page-break-before: avoid; }
  h3 { color: #0f3460; }
  ul, ol { padding-left: 1.5em; }
  li { margin: 0.3em 0; }
  strong { color: #e94560; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
  img { max-width: 100%; border-radius: 8px; margin: 1em 0; }
  @media print { h2 { page-break-before: always; } }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

// --- Run a skill ---

function runSkill(skillName, prompt, triggeredBy = 'manual') {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}_${Math.random().toString(36).slice(2, 8)}`;
  const runDir = path.join(RUNS_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const meta = {
    id: runId,
    skill: skillName,
    prompt,
    triggeredBy,
    startedAt: new Date().toISOString(),
    status: 'running',
  };
  fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify(meta, null, 2));

  const options = getOptions();
  const model = options.model || 'claude-sonnet-4-6';
  const args = ['-p', '--model', model];

  // Build the prompt
  const skillFile = path.join(SKILLS_DIR, `${skillName}.md`);
  let fullPrompt;
  if (fs.existsSync(skillFile)) {
    const skillContent = fs.readFileSync(skillFile, 'utf8');
    const userPrompt = prompt || `Kør ${skillName} skillen. Brug den aktuelle dato til at bestemme ugenummer og sæson.`;
    fullPrompt = `<skill>\n${skillContent}\n</skill>\n\n${userPrompt}\n\nVIGTIGT: Output KUN madplanens markdown-indhold. Ingen forklaringer, ingen kodeblokke, ingen indledende tekst. Start direkte med "# Madplan uge..."`;
  } else {
    fullPrompt = prompt || `Run the ${skillName} skill`;
  }
  args.push(fullPrompt);

  // Auth env
  const authEnv = {};
  if (options.api_key) authEnv.ANTHROPIC_API_KEY = options.api_key;
  if (options.auth_token) authEnv.ANTHROPIC_AUTH_TOKEN = options.auth_token;
  if (options.base_url) authEnv.ANTHROPIC_BASE_URL = options.base_url;

  const proc = spawn('claude', args, {
    env: { ...process.env, HOME: '/data', CLAUDE_CONFIG_DIR: '/data/claude', ...authEnv },
    cwd: runDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';

  proc.stdout.on('data', (chunk) => {
    output += chunk.toString();
    broadcast({ type: 'output', runId, text: chunk.toString() });
  });

  proc.stderr.on('data', (chunk) => {
    output += chunk.toString();
    broadcast({ type: 'output', runId, text: chunk.toString() });
  });

  proc.on('close', async (code) => {
    meta.status = code === 0 ? 'completed' : 'failed';
    meta.finishedAt = new Date().toISOString();
    meta.exitCode = code;

    if (code === 0 && skillName === 'madplan') {
      // Save markdown to shared folder
      const now = new Date();
      const weekNum = getWeekNumber(now);
      const filename = `madplan-uge-${weekNum}-${now.getFullYear()}`;
      const mdPath = path.join(SHARE_DIR, filename + '.md');

      fs.mkdirSync(SHARE_DIR, { recursive: true });
      fs.writeFileSync(mdPath, output);
      meta.outputFile = filename;

      // Generate PDF
      try {
        await generatePdf(mdPath);
        meta.hasPdf = true;
        console.log(`PDF generated: ${filename}.pdf`);
      } catch (err) {
        console.error('PDF generation failed:', err.message);
        meta.hasPdf = false;
      }

      // Update HA sensor
      updateHASensor(skillName, meta, output);
    }

    fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify(meta, null, 2));
    activeRuns.delete(runId);
    broadcast({ type: 'completed', runId, status: meta.status, outputFile: meta.outputFile });
  });

  activeRuns.set(runId, { proc, meta });
  broadcast({ type: 'started', runId, meta });
  return meta;
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// --- HA Sensor ---

async function updateHASensor(skillName, meta, output) {
  if (!SUPERVISOR_TOKEN) return;
  const sensorId = `sensor.claude_skill_${skillName.replace(/[^a-z0-9]/gi, '_')}`;
  const payload = {
    state: meta.status,
    attributes: {
      friendly_name: `Claude Skill: ${skillName}`,
      last_run: meta.startedAt,
      finished_at: meta.finishedAt || null,
      output_file: meta.outputFile || null,
      output_markdown: (output || '').slice(0, 16000),
      icon: 'mdi:food',
    },
  };
  try {
    await fetch(`http://supervisor/core/api/states/${sensorId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUPERVISOR_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('HA sensor update failed:', err.message);
  }
}

// --- WebSocket ---

function broadcast(msg) {
  const payload = JSON.stringify(msg);
  wss.clients.forEach(client => { if (client.readyState === 1) client.send(payload); });
}

// --- API Routes ---

app.get('/api/madplaner', (req, res) => {
  res.json(listMadplaner());
});

app.get('/api/madplaner/:id', (req, res) => {
  const html = getMadplanHtml(req.params.id);
  if (!html) return res.status(404).json({ error: 'not found' });
  res.json({ id: req.params.id, html });
});

app.get('/api/madplaner/:id/raw', (req, res) => {
  const mdPath = path.join(SHARE_DIR, req.params.id + '.md');
  if (!fs.existsSync(mdPath)) return res.status(404).send('not found');
  res.type('text/markdown').send(fs.readFileSync(mdPath, 'utf8'));
});

app.post('/api/run', (req, res) => {
  const { skill, prompt, triggeredBy } = req.body;
  if (!skill) return res.status(400).json({ error: 'skill is required' });
  const meta = runSkill(skill, prompt, triggeredBy || 'api');
  res.json(meta);
});

app.get('/api/status', (req, res) => {
  const running = activeRuns.size > 0;
  const current = running ? [...activeRuns.values()][0].meta : null;
  res.json({ running, current });
});

app.get('/api/auth-status', (req, res) => {
  const opts = getOptions();
  const hasAuth = !!(opts.api_key || opts.auth_token);
  res.json({ authenticated: hasAuth });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Scheduler ---

function loadSchedules() {
  if (!fs.existsSync(OPTIONS_PATH)) return;
  const options = JSON.parse(fs.readFileSync(OPTIONS_PATH, 'utf8'));
  for (const [, job] of scheduledJobs) job.stop();
  scheduledJobs.clear();

  for (const skill of (options.skills || [])) {
    if (!skill.schedule || !cron.validate(skill.schedule)) continue;
    const job = cron.schedule(skill.schedule, () => {
      console.log(`[scheduler] Running: ${skill.name}`);
      runSkill(skill.name, skill.prompt, 'schedule');
    });
    scheduledJobs.set(skill.name, job);
    console.log(`[scheduler] ${skill.name} @ ${skill.schedule}`);
  }
}

// --- Start ---

const PORT = process.env.INGRESS_PORT || 8099;
server.listen(PORT, () => {
  console.log(`Claude Skills Runner v0.5.0 on port ${PORT}`);
  fs.mkdirSync(SHARE_DIR, { recursive: true });
  loadSchedules();
});
