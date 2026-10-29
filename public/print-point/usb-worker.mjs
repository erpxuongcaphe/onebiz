import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function nativeUsbExecutable(script) {
  const path = join(dirname(resolve(script)), 'OnebizUsbWorker.exe');
  return existsSync(path) ? path : null;
}
export function printFailureStatus(error, attempted) {
  return attempted && error.printAttempted !== false ? 'unknown' : 'failed';
}

// One outstanding send only. A lost response must never replay a physical job.
export function createUsbWorker(script, spawnProcess = spawn, timeoutMs = 45000, nativeExecutable = nativeUsbExecutable(script)) {
  let child, ready, pending, readyReject, startupTimer, lines, disposed = false;
  const stop = error => {
    error.printAttempted = Boolean(pending);
    const process = child; child = null; ready = null;
    clearTimeout(startupTimer); startupTimer = null;
    const reject = readyReject; readyReject = null; reject?.(error);
    pending?.reject(error); pending = null;
    lines?.close(); lines = null;
    process?.kill();
  };
  const start = () => {
    if (disposed) return Promise.reject(new Error('USB_WORKER_STOPPED'));
    if (ready) return ready;
    let resolveReady;
    ready = new Promise((resolve, reject) => { resolveReady = resolve; readyReject = reject; });
    const started = ready;
    try {
      const process = spawnProcess(nativeExecutable || 'powershell.exe', nativeExecutable ? [] : ['-NoProfile', '-NonInteractive', '-File', script, '-Worker'],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      child = process;
      let initialized = false;
      startupTimer = setTimeout(() => stop(new Error('USB_WORKER_START_TIMEOUT')), nativeExecutable ? Math.min(10000, timeoutMs) : timeoutMs);
      lines = createInterface({ input: process.stdout });
      process.stderr.on('data', () => {});
      lines.on('line', line => {
        if (child !== process) return;
        try {
          const result = JSON.parse(line);
          if (result.ready === true && !initialized) { initialized = true; clearTimeout(startupTimer); readyReject = null; resolveReady(); return; }
          if (!initialized || !pending || !['handed_off', 'failed', 'unknown'].includes(result.status)) throw new Error('USB_WORKER_INVALID_RESPONSE');
          const request = pending; pending = null; request.resolve(result);
        } catch (error) { stop(error); }
      });
      const failed = () => {
        if (child !== process) return;
        stop(new Error(initialized ? 'USB_WORKER_DISCONNECTED_CHECK_PAPER' : 'USB_WORKER_START_FAILED'));
      };
      process.on('error', failed); process.on('close', failed);
    } catch (error) { stop(error); }
    return started;
  };
  return {
    warm: start,
    async send(file, printer) {
      try { await start(); } catch (error) { error.printAttempted = false; throw error; }
      if (pending) throw new Error('USB_WORKER_BUSY');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => stop(new Error('USB_WORKER_TIMEOUT_CHECK_PAPER')), timeoutMs);
        pending = {
          resolve: result => { clearTimeout(timer); resolve(result); },
          reject: error => { clearTimeout(timer); reject(error); },
        };
        try { child.stdin.write(JSON.stringify({ file, printer }) + '\n', error => { if (error) stop(error); }); }
        catch (error) { stop(error); }
      });
    },
    close() { disposed = true; stop(new Error('USB_WORKER_STOPPED')); },
  };
}
