const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, 'skills');
const RUNS_DIR = path.join(__dirname, 'runs');
const SHARE_DIR = path.join(__dirname, 'share');

const skillName = 'madplan';
const model = 'sonnet';

// Build prompt exactly like server.js does
const skillFile = path.join(SKILLS_DIR, `${skillName}.md`);
const skillContent = fs.readFileSync(skillFile, 'utf8');
const userPrompt = `Kør ${skillName} skillen. Brug den aktuelle dato til at bestemme ugenummer og sæson.`;
const fullPrompt = `<skill>\n${skillContent}\n</skill>\n\n${userPrompt}\n\nVIGTIGT: Output KUN madplanens markdown-indhold. Ingen forklaringer, ingen kodeblokke, ingen indledende tekst. Start direkte med "# Madplan uge..."`;

console.log(`Prompt length: ${fullPrompt.length} chars`);
console.log(`Model: ${model}`);
console.log('Spawning claude...\n');

const args = ['-p', '--model', model];

// Write prompt to file, pipe via shell (mirrors Linux behavior in Docker)
const fs2 = require('fs');
const promptFile = path.join(RUNS_DIR, 'prompt.txt');
fs2.writeFileSync(promptFile, fullPrompt);

const shellCmd = process.platform === 'win32'
  ? `type "${promptFile}" | claude -p --model ${model}`
  : `cat "${promptFile}" | claude -p --model ${model}`;

const proc = spawn(process.platform === 'win32' ? 'cmd' : 'sh',
  process.platform === 'win32' ? ['/c', shellCmd] : ['-c', shellCmd], {
  cwd: RUNS_DIR,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';

proc.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
  process.stdout.write(chunk);
});

proc.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
  process.stderr.write(chunk);
});

proc.on('close', (code) => {
  console.log(`\n\n--- EXIT CODE: ${code} ---`);
  if (stderr) console.log(`--- STDERR: ${stderr} ---`);
  console.log(`--- OUTPUT LENGTH: ${stdout.length} chars ---`);
});
