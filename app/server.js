const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
const cron = require('node-cron');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const RUNS_DIR = '/data/runs';
const SKILLS_DIR = '/data/skills';
const OPTIONS_PATH = '/data/options.json';
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;
const INGRESS_PATH = process.env.INGRESS_PATH || '';

function getOptions() {
  if (fs.existsSync(OPTIONS_PATH)) {
    return JSON.parse(fs.readFileSync(OPTIONS_PATH, 'utf8'));
  }
  return {};
}

function getApiKey() {
  return getOptions().api_key || '';
}

function getAuthToken() {
  return getOptions().auth_token || '';
}

function getBaseUrl() {
  return getOptions().base_url || '';
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Track active runs
const activeRuns = new Map();
const scheduledJobs = new Map();

// --- Utility ---

function generateRunId() {
  const now = new Date();
  return `${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getRunMeta(runId) {
  const metaPath = path.join(RUNS_DIR, runId, 'meta.json');
  if (fs.existsSync(metaPath)) {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  }
  return null;
}

function listRuns() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs.readdirSync(RUNS_DIR)
    .filter(f => fs.statSync(path.join(RUNS_DIR, f)).isDirectory())
    .map(id => getRunMeta(id))
    .filter(Boolean)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

// --- Run a skill ---

function runSkill(skillName, prompt, triggeredBy = 'manual') {
  const runId = generateRunId();
  const runDir = path.join(RUNS_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const meta = {
    id: runId,
    skill: skillName,
    prompt,
    triggeredBy,
    startedAt: new Date().toISOString(),
    status: 'running',
    output: '',
  };
  fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify(meta, null, 2));

  // Build claude command — use -p (print mode) with the prompt as positional arg
  const args = ['-p'];

  // If there's a skill file, prepend its content as context in the prompt
  const skillFile = path.join(SKILLS_DIR, `${skillName}.md`);
  let fullPrompt;
  if (fs.existsSync(skillFile)) {
    const skillContent = fs.readFileSync(skillFile, 'utf8');
    const userPrompt = prompt || `Kør ${skillName} skillen. Brug den aktuelle dato til at bestemme ugenummer og sæson.`;
    fullPrompt = `<skill>\n${skillContent}\n</skill>\n\n${userPrompt}`;
  } else {
    fullPrompt = prompt || `Run the ${skillName} skill`;
  }
  args.push(fullPrompt);

  const authEnv = {};
  const apiKey = getApiKey();
  const authToken = getAuthToken();
  const baseUrl = getBaseUrl();
  if (apiKey) authEnv.ANTHROPIC_API_KEY = apiKey;
  if (authToken) authEnv.ANTHROPIC_AUTH_TOKEN = authToken;
  if (baseUrl) authEnv.ANTHROPIC_BASE_URL = baseUrl;

  const proc = spawn('claude', args, {
    env: {
      ...process.env,
      HOME: '/data',
      CLAUDE_CONFIG_DIR: '/data/claude',
      ...authEnv,
    },
    cwd: runDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';

  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    output += text;
    // Broadcast to WebSocket clients
    broadcast({ type: 'output', runId, text });
  });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    output += `[stderr] ${text}`;
    broadcast({ type: 'output', runId, text: `[stderr] ${text}` });
  });

  proc.on('close', (code) => {
    meta.status = code === 0 ? 'completed' : 'failed';
    meta.finishedAt = new Date().toISOString();
    meta.output = output;
    meta.exitCode = code;
    fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify(meta, null, 2));

    // Save output as markdown file too
    fs.writeFileSync(path.join(runDir, 'output.md'), output);

    // Push result to HA sensor
    updateHASensor(skillName, meta);

    activeRuns.delete(runId);
    broadcast({ type: 'completed', runId, status: meta.status });
  });

  activeRuns.set(runId, { proc, meta });
  broadcast({ type: 'started', runId, meta });

  return meta;
}

// --- HA Sensor Integration ---

async function updateHASensor(skillName, meta) {
  if (!SUPERVISOR_TOKEN) return;

  const sensorId = `sensor.claude_skill_${skillName.replace(/[^a-z0-9]/gi, '_')}`;
  const payload = {
    state: meta.status,
    attributes: {
      friendly_name: `Claude Skill: ${skillName}`,
      last_run: meta.startedAt,
      finished_at: meta.finishedAt || null,
      output_markdown: meta.output.slice(0, 16000),
      run_id: meta.id,
      triggered_by: meta.triggeredBy,
      icon: 'mdi:robot',
    },
  };

  try {
    const res = await fetch(`http://supervisor/core/api/states/${sensorId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPERVISOR_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error(`Failed to update HA sensor: ${res.status}`);
  } catch (err) {
    console.error('Error updating HA sensor:', err.message);
  }
}

// --- WebSocket ---

function broadcast(msg) {
  const payload = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(payload);
  });
}

wss.on('connection', (ws) => {
  // Send current active runs
  for (const [runId, { meta }] of activeRuns) {
    ws.send(JSON.stringify({ type: 'started', runId, meta }));
  }
});

// --- API Routes ---

app.get('/api/runs', (req, res) => {
  res.json(listRuns().slice(0, 50));
});

app.get('/api/runs/:id', (req, res) => {
  const meta = getRunMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'not found' });
  res.json(meta);
});

app.post('/api/run', (req, res) => {
  const { skill, prompt, triggeredBy } = req.body;
  if (!skill) return res.status(400).json({ error: 'skill is required' });
  const meta = runSkill(skill, prompt, triggeredBy || 'api');
  res.json(meta);
});

app.get('/api/skills', (req, res) => {
  if (!fs.existsSync(SKILLS_DIR)) return res.json([]);
  const skills = fs.readdirSync(SKILLS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => ({ name: f.replace('.md', ''), file: f }));
  res.json(skills);
});

app.get('/api/auth-status', (req, res) => {
  const hasAuth = !!(getApiKey() || getAuthToken());
  res.json({ authenticated: hasAuth });
});

// Serve the web UI for all other routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Scheduler ---

function loadSchedules() {
  // Read config from HA add-on options
  const optionsPath = '/data/options.json';
  if (!fs.existsSync(optionsPath)) return;

  const options = JSON.parse(fs.readFileSync(optionsPath, 'utf8'));
  const skills = options.skills || [];

  // Clear existing schedules
  for (const [name, job] of scheduledJobs) {
    job.stop();
  }
  scheduledJobs.clear();

  for (const skill of skills) {
    if (!skill.schedule) continue;
    if (!cron.validate(skill.schedule)) {
      console.error(`Invalid cron schedule for ${skill.name}: ${skill.schedule}`);
      continue;
    }

    const job = cron.schedule(skill.schedule, () => {
      console.log(`[scheduler] Running skill: ${skill.name}`);
      runSkill(skill.name, skill.prompt, 'schedule');
    });

    scheduledJobs.set(skill.name, job);
    console.log(`[scheduler] Registered: ${skill.name} @ ${skill.schedule}`);
  }
}

// --- Start ---

const PORT = process.env.INGRESS_PORT || 8099;

server.listen(PORT, () => {
  console.log(`Claude Skills Runner listening on port ${PORT}`);
  loadSchedules();
});
