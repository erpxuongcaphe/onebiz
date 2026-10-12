import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// One outstanding send only. A lost response must never replay a physical job.
export function createUsbWorker(script, spawnProcess = spawn, timeoutMs = 45000) {
  let child, ready, pending, disposed = false;
  const stop = error => {
    pending?.reject(error); pending = null;
    child?.kill(); child = null; ready = null;
  };
  const start = () => {
    if (disposed) return Promise.reject(new Error('USB_WORKER_STOPPED'));
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      const process = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, '-Worker'],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      child = process;
      let initialized = false;
      const timer = setTimeout(() => { reject(new Error('USB_WORKER_START_TIMEOUT')); stop(new Error('USB_WORKER_START_TIMEOUT')); }, timeoutMs);
      const lines = createInterface({ input: process.stdout });
      process.stderr.on('data', () => {});
      lines.on('line', line => {
        if (child !== process) return;
        try {
          const result = JSON.parse(line);
          if (result.ready === true && !initialized) { initialized = true; clearTimeout(timer); resolve(); return; }
          if (!initialized || !pending || !['handed_off', 'failed', 'unknown'].includes(result.status)) throw new Error('USB_WORKER_INVALID_RESPONSE');
          const request = pending; pending = null; request.resolve(result);
        } catch (error) { reject(error); clearTimeout(timer); stop(error); }
      });
      const failed = () => {
        clearTimeout(timer); lines.close();
        if (child !== process) return;
        const error = new Error('USB_WORKER_DISCONNECTED_CHECK_PAPER');
        reject(error); stop(error);
      };
      process.on('error', failed); process.on('close', failed);
    });
    return ready;
  };
  return {
    warm: start,
    async send(file, printer) {
      await start();
      if (pending) throw new Error('USB_WORKER_BUSY');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => stop(new Error('USB_WORKER_TIMEOUT_CHECK_PAPER')), timeoutMs);
        pending = {
          resolve: result => { clearTimeout(timer); resolve(result); },
          reject: error => { clearTimeout(timer); reject(error); },
        };
        child.stdin.write(JSON.stringify({ file, printer }) + '\n', error => { if (error) stop(error); });
      });
    },
    close() { disposed = true; stop(new Error('USB_WORKER_STOPPED')); },
  };
}
