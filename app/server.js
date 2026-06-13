const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
const cron = require('node-cron');
const markdownIt = require('markdown-it');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const md = markdownIt({ html: true, linkify: true });

const RUNS_DIR = '/data/runs';
const SKILLS_DIR = '/data/skills';
const SHARE_DIR = '/share/madplaner';
const OPTIONS_PATH = '/data/options.json';
const RATINGS_PATH = '/data/ratings.json';
const FEEDBACK_PATH = '/data/feedback.json';
const IMAGE_CACHE_PATH = '/data/image-cache.json';
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;

app.use(express.json());
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
      const stat = fs.statSync(mdPath);
      const match = name.match(/uge-(\d+)-(\d+)/);
      return {
        id: name,
        file: f,
        week: match ? parseInt(match[1]) : null,
        year: match ? parseInt(match[2]) : null,
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

// --- Checked items persistence ---

function getCheckedPath(planId) {
  return path.join(SHARE_DIR, planId + '.checked.json');
}

function getCheckedItems(planId) {
  const p = getCheckedPath(planId);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  return [];
}

function saveCheckedItems(planId, items) {
  fs.writeFileSync(getCheckedPath(planId), JSON.stringify(items));
}

// --- Ratings ---

function getRatings() {
  if (fs.existsSync(RATINGS_PATH)) return JSON.parse(fs.readFileSync(RATINGS_PATH, 'utf8'));
  return {};
}

function saveRatings(data) {
  fs.writeFileSync(RATINGS_PATH, JSON.stringify(data, null, 2));
}

// --- Feedback ---

function getFeedback() {
  if (fs.existsSync(FEEDBACK_PATH)) return JSON.parse(fs.readFileSync(FEEDBACK_PATH, 'utf8'));
  return {};
}

function saveFeedback(data) {
  fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(data, null, 2));
}

// --- Image resolution ---

function getImageCache() {
  if (fs.existsSync(IMAGE_CACHE_PATH)) return JSON.parse(fs.readFileSync(IMAGE_CACHE_PATH, 'utf8'));
  return {};
}

function saveImageCache(data) {
  fs.writeFileSync(IMAGE_CACHE_PATH, JSON.stringify(data, null, 2));
}

async function resolveImages(markdownContent) {
  const options = getOptions();
  const apiKey = options.pexels_api_key;
  if (!apiKey) return markdownContent;

  const cache = getImageCache();
  const pattern = /!\[([^\]]*)\]\(image-search:([^)]+)\)/g;
  let result = markdownContent;
  const matches = [...markdownContent.matchAll(pattern)];

  for (const match of matches) {
    const [fullMatch, alt, query] = match;
    const trimmedQuery = query.trim();

    let imageUrl = cache[trimmedQuery];
    if (!imageUrl) {
      try {
        const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(trimmedQuery)}&per_page=1&orientation=landscape`, {
          headers: { Authorization: apiKey },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.photos && data.photos.length > 0) {
            imageUrl = data.photos[0].src.medium;
            cache[trimmedQuery] = imageUrl;
          }
        }
      } catch (err) {
        console.error(`Image fetch failed for "${trimmedQuery}":`, err.message);
      }
    }

    if (imageUrl) {
      result = result.replace(fullMatch, `![${alt}](${imageUrl})`);
    } else {
      result = result.replace(fullMatch, '');
    }
  }

  saveImageCache(cache);
  return result;
}

// --- Shopping list extraction ---

function extractShoppingList(markdownContent, checkedItems) {
  const lines = markdownContent.split('\n');
  let inShoppingSection = false;
  let output = '';
  let itemIndex = 0;
  let currentCategory = '';

  for (const line of lines) {
    if (/^#\s*Indkøbsliste/i.test(line)) {
      inShoppingSection = true;
      output += line.replace(/^#+\s*/, '').trim() + '\n';
      output += '='.repeat(30) + '\n\n';
      continue;
    }

    if (inShoppingSection) {
      if (/^#(?!#)/.test(line) && !/indkøb/i.test(line)) break;

      if (/^###\s*/.test(line)) {
        currentCategory = line.replace(/^###\s*/, '').trim();
        output += currentCategory + '\n';
        output += '-'.repeat(currentCategory.length) + '\n';
      } else if (/^\s*[-*]\s+/.test(line)) {
        const itemText = line.replace(/^\s*[-*]\s+/, '').trim();
        const isChecked = checkedItems.includes(itemIndex);
        output += `${isChecked ? '[x]' : '[ ]'} ${itemText}\n`;
        itemIndex++;
      } else if (line.trim() === '') {
        output += '\n';
      }
    }
  }

  return output.trim() + '\n';
}

// --- Recent context for feedback loop ---

function getRecentContext() {
  const feedback = getFeedback();
  const ratings = getRatings();
  const plans = listMadplaner().slice(0, 3);

  let context = '';
  for (const plan of plans) {
    const planFeedback = feedback[plan.id];
    const planRatings = ratings[plan.id];
    if (!planFeedback && !planRatings) continue;

    context += `\n### ${plan.id}:\n`;
    if (planRatings) {
      for (const [recipe, users] of Object.entries(planRatings)) {
        const vals = Object.values(users);
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        context += `- ${recipe}: ${avg.toFixed(1)}/5 stjerner\n`;
      }
    }
    if (planFeedback) {
      for (const [user, text] of Object.entries(planFeedback)) {
        const truncated = text.length > 300 ? text.slice(0, 300) + '...' : text;
        context += `- ${user}: "${truncated}"\n`;
      }
    }
  }
  return context;
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
  const model = options.model || 'sonnet';
  const args = ['-p', '--model', model];

  // Build the prompt
  const skillFile = path.join(SKILLS_DIR, `${skillName}.md`);
  let fullPrompt;
  if (fs.existsSync(skillFile)) {
    const skillContent = fs.readFileSync(skillFile, 'utf8');
    const recentContext = skillName === 'madplan' ? getRecentContext() : '';
    const feedbackSection = recentContext
      ? `\n\n<previous_feedback>\n${recentContext}\n</previous_feedback>\n\nTag hensyn til ovenstående feedback når du genererer den nye madplan. VIGTIGT: Feedback må IKKE overskride kostprincipperne (ingen fisk, laktosefri, bælgfrugter i mindst 3 retter, etc.). Brug feedback til at justere smagspræferencer, variationsønsker og portionsstørrelser. Retter med høj rating (4-5 stjerner) kan genbruges eller varieres. Retter med lav rating (1-2) bør undgås.`
      : '';
    const userPrompt = prompt || `Kør ${skillName} skillen. Brug den aktuelle dato til at bestemme ugenummer og sæson.`;
    fullPrompt = `<skill>\n${skillContent}\n</skill>${feedbackSection}\n\n${userPrompt}\n\nVIGTIGT: Output KUN madplanens markdown-indhold. Ingen forklaringer, ingen kodeblokke, ingen indledende tekst. Start direkte med "# Madplan uge..."`;
  } else {
    fullPrompt = prompt || `Run the ${skillName} skill`;
  }
  // Auth env
  const authEnv = {};
  if (options.api_key) authEnv.ANTHROPIC_API_KEY = options.api_key;

  // Write prompt to file and pipe via shell to avoid argument escaping issues
  const promptFile = path.join(runDir, 'prompt.txt');
  fs.writeFileSync(promptFile, fullPrompt);

  console.log(`[run] Skill: ${skillName}, Model: ${model}, Prompt length: ${fullPrompt.length}`);
  console.log(`[run] API key configured: ${!!options.api_key}`);
  console.log(`[run] Prompt file: ${promptFile}`);

  const proc = spawn('sh', ['-c', `cat "${promptFile}" | claude -p --model ${model}`], {
    env: { ...process.env, HOME: '/data', CLAUDE_CONFIG_DIR: '/data/claude', ...authEnv },
    cwd: runDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  let stderr = '';

  proc.stdout.on('data', (chunk) => {
    output += chunk.toString();
    broadcast({ type: 'output', runId, text: chunk.toString() });
  });

  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
    console.error(`[${runId}] stderr:`, chunk.toString());
    broadcast({ type: 'output', runId, text: chunk.toString() });
  });

  proc.on('error', (err) => {
    console.error(`[run] Process spawn error:`, err.message);
  });

  proc.on('close', async (code) => {
    console.log(`[run] Process exited with code ${code}, stdout length: ${output.length}, stderr length: ${stderr.length}`);
    if (code !== 0) console.error(`[run] FAILED OUTPUT: ${output.slice(0, 500)}`);
    if (stderr) console.error(`[run] STDERR: ${stderr.slice(0, 500)}`);
    meta.status = code === 0 ? 'completed' : 'failed';
    meta.finishedAt = new Date().toISOString();
    meta.exitCode = code;

    if (code === 0 && skillName === 'madplan') {
      const now = new Date();
      const weekNum = getWeekNumber(now);
      const filename = `madplan-uge-${weekNum}-${now.getFullYear()}`;
      const mdPath = path.join(SHARE_DIR, filename + '.md');

      fs.mkdirSync(SHARE_DIR, { recursive: true });

      let finalOutput = output;
      try {
        finalOutput = await resolveImages(output);
      } catch (err) {
        console.error('Image resolution failed, using raw output:', err.message);
      }

      fs.writeFileSync(mdPath, finalOutput);
      meta.outputFile = filename;

      updateHASensor(skillName, meta, finalOutput);
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
  const checked = getCheckedItems(req.params.id);
  res.json({ id: req.params.id, html, checked });
});

app.post('/api/madplaner/:id/checked', (req, res) => {
  const { checked } = req.body;
  if (!Array.isArray(checked)) return res.status(400).json({ error: 'checked must be an array' });
  saveCheckedItems(req.params.id, checked);
  res.json({ ok: true });
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

// --- Shopping list download ---

app.get('/api/madplaner/:id/shopping-list.txt', (req, res) => {
  const mdPath = path.join(SHARE_DIR, req.params.id + '.md');
  if (!fs.existsSync(mdPath)) return res.status(404).send('Not found');

  const content = fs.readFileSync(mdPath, 'utf8');
  const checked = getCheckedItems(req.params.id);
  const shoppingText = extractShoppingList(content, checked);

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}-indkobsliste.txt"`);
  res.send(shoppingText);
});

// --- Ratings ---

app.get('/api/madplaner/:id/ratings', (req, res) => {
  const ratings = getRatings();
  res.json(ratings[req.params.id] || {});
});

app.post('/api/madplaner/:id/ratings', (req, res) => {
  const { recipe, user, rating } = req.body;
  if (!recipe || !user || !rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Invalid rating data' });
  }
  const ratings = getRatings();
  if (!ratings[req.params.id]) ratings[req.params.id] = {};
  if (!ratings[req.params.id][recipe]) ratings[req.params.id][recipe] = {};
  ratings[req.params.id][recipe][user] = rating;
  saveRatings(ratings);
  res.json({ ok: true });
});

// --- Feedback ---

app.get('/api/madplaner/:id/feedback', (req, res) => {
  const feedback = getFeedback();
  res.json(feedback[req.params.id] || {});
});

app.post('/api/madplaner/:id/feedback', (req, res) => {
  const { user, text } = req.body;
  if (!user || typeof text !== 'string') {
    return res.status(400).json({ error: 'Invalid feedback data' });
  }
  const feedback = getFeedback();
  if (!feedback[req.params.id]) feedback[req.params.id] = {};
  feedback[req.params.id][user] = text;
  saveFeedback(feedback);
  res.json({ ok: true });
});

// --- Current user detection via HA auth ---

app.get('/api/current-user', async (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');

  // Use the user's HA token to ask HA Core who they are
  if (token) {
    try {
      const haRes = await fetch('http://supervisor/core/api/current_user', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (haRes.ok) {
        const user = await haRes.json();
        return res.json({ name: user.name, id: user.id });
      }
    } catch (e) {}
  }

  // Fallback: check ingress headers
  const ingressUser = req.headers['x-remote-user-display-name'] || req.headers['x-remote-user-name'];
  if (ingressUser) {
    return res.json({ name: ingressUser, id: ingressUser });
  }

  res.json({ name: '', id: '' });
});

app.get('/api/version', (req, res) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  res.json({ version: pkg.version });
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
  console.log(`Claude Skills Runner v0.7.0 on port ${PORT}`);
  fs.mkdirSync(SHARE_DIR, { recursive: true });
  loadSchedules();
});
