// Starts the simulation in a Web Worker, or on the page if that fails.
//
// In the single-file Artifact build the worker source is embedded in the
// page and started from a blob: URL; during development it is an ES module
// worker loaded from src/worker/sim-worker.js.

import { createHost } from '../worker/host.js';

export function createSimClient(onMessage) {
  let worker = null;
  let inline = null;
  let mode = 'worker';
  let gotReply = false;

  const handle = (msg) => {
    if (!gotReply) queue.length = 0;
    gotReply = true;
    onMessage(msg);
  };

  const startInline = (why) => {
    if (inline) return;
    if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } worker = null; }
    mode = 'page';
    console.warn('Running the simulation on the page thread:', why);
    inline = createHost((msg) => handle(msg), { budgetMs: 7 });
    for (const m of queue) inline.onMessage(m);
    queue.length = 0;
  };

  const queue = [];
  try {
    const src = globalThis.__FLATCELL_WORKER_SOURCE__;
    if (src) {
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      worker = new Worker(url);
    } else {
      worker = new Worker(new URL('../worker/sim-worker.js', import.meta.url), { type: 'module' });
    }
    worker.onmessage = (e) => handle(e.data);
    worker.onerror = (e) => { if (!gotReply) startInline(e.message || 'worker error'); };
    // A worker that never answers (blocked by the page's sandbox) also
    // triggers the fallback.
    setTimeout(() => { if (!gotReply) startInline('worker did not respond'); }, 2500);
  } catch (err) {
    startInline(err.message);
  }

  return {
    get mode() { return mode; },
    send(msg) {
      if (inline) inline.onMessage(msg);
      else if (worker) { worker.postMessage(msg); if (!gotReply) queue.push(msg); }
      else queue.push(msg);
    },
  };
}
