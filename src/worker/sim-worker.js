// Web Worker entry point: the simulation runs here, off the page's thread.
import { createHost } from './host.js';

const host = createHost((msg, transfer) => postMessage(msg, transfer || []));
onmessage = (e) => host.onMessage(e.data);
