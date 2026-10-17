// Stop and SubagentStop. A worker may only finish with "Verdict: READY" if the task's acceptance
// commands (tasks.json -> acceptance.commands) really pass. No proof, no "done".
// Commands must finish in under 2 minutes. Long jobs write a result file instead:
//   { "result_file": "scratch/results/<task>.json" }  -> must contain "passed": true (or "status": "pass").
// Does nothing unless the message claims READY, so ordinary stops (questions, progress) are never blocked.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadJson, readInput, repoRoot } from './lib.mjs';

const BUDGET_MS = 110_000;

try {
  const input = readInput();
  if (input.stop_hook_active) process.exit(0); // already continuing because of this hook: never loop
  const msg = String(input.last_assistant_message ?? '');
  const claimsReady = /\bverdict\b[^\n]{0,20}\bREADY\b/i.test(msg) && !/\bverdict\b[^\n]{0,20}\bNOT READY\b/i.test(msg);
  if (!claimsReady) process.exit(0);

  const root = repoRoot(input);
  let taskId = null;
  try {
    taskId = loadJson(join(root, '.claude', 'lane.local.json'), null)?.task ?? null;
  } catch {
    /* broken lane file: fall back to the branch name */
  }
  if (!taskId) {
    const r = spawnSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' });
    const last = String(r.stdout || '').trim().split('/').pop() || '';
    taskId = last.match(/^([A-Z]\d+|\d\.\d)(?:-|$)/)?.[1] ?? null;
  }
  if (!taskId) process.exit(0); // not on a task branch

  const task = (loadJson(join(root, 'tasks.json'), { tasks: [] }).tasks || []).find((t) => t.id === taskId);
  const checks = task?.acceptance?.commands || [];
  if (!checks.length) {
    process.stderr.write(`evidence-gate: task ${taskId} has no acceptance commands yet (tests await human approval), so nothing to run.\n`);
    process.exit(0);
  }

  const started = Date.now();
  const failures = [];
  for (const check of checks) {
    if (typeof check === 'object' && check.result_file) {
      const file = join(root, check.result_file);
      let ok = false;
      try {
        const r = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
        ok = Boolean(r && (r.passed === true || r.status === 'pass'));
      } catch {
        ok = false;
      }
      if (!ok) failures.push(`Result file ${check.result_file} is missing or does not say passed: true.`);
      continue;
    }
    const cmd = typeof check === 'string' ? check : check.cmd;
    const left = BUDGET_MS - (Date.now() - started);
    if (left <= 0) {
      failures.push(`Out of time before running: ${cmd}. Make the check faster, or have the long job write a result file.`);
      continue;
    }
    const r = spawnSync(cmd, { shell: true, cwd: root, encoding: 'utf8', timeout: left });
    if (r.status !== 0) {
      const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-12).join('\n');
      failures.push(`Command failed: ${cmd}\n${out}`);
    }
  }

  if (failures.length) {
    process.stdout.write(
      `${JSON.stringify({
        decision: 'block',
        reason: `Not done yet: task ${taskId} acceptance checks did not pass. Fix this, re-run, then report the verdict again.\n\n${failures.join('\n\n')}`,
      })}\n`,
    );
  }
  process.exit(0);
} catch (e) {
  process.stderr.write(`evidence-gate: skipped because of an error (${e.message})\n`);
  process.exit(0);
}
