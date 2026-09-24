import { spawn } from 'node:child_process';
const [secondsRaw, command, ...args] = process.argv.slice(2);
const seconds = Number(secondsRaw);
if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600 || !command) throw new Error('BOUNDED_COMMAND_USAGE');
const child = spawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let failed = false, bytes = 0, killTimer;
function signalGroup(signal) { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') failed = true; } }
function stop() {
  if (failed) return;
  failed = true;
  signalGroup('SIGTERM');
  killTimer = setTimeout(() => signalGroup('SIGKILL'), 2000);
}
const timer = setTimeout(stop, seconds * 1000);
process.once('SIGTERM', stop); process.once('SIGINT', stop);
for (const [stream, out] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
  stream.on('data', chunk => { bytes += chunk.length; if (bytes <= 8 * 1024 * 1024) out.write(chunk); else stop(); });
}
child.once('error', stop);
child.once('close', code => {
  clearTimeout(timer);
  // Terminate any still-running descendants of this invocation before returning.
  signalGroup('SIGTERM');
  if (killTimer) clearTimeout(killTimer);
  setTimeout(() => {
    signalGroup('SIGKILL');
    if (failed) process.stderr.write('BOUNDED_COMMAND_FAILED\n');
    process.exit(code === 0 && !failed ? 0 : 1);
  }, 100);
});
