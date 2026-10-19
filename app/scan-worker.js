const { parentPort, workerData } = require('worker_threads');
const { buildData } = require('../scan.js');

try {
  parentPort.postMessage({ data: buildData(workerData.root) });
} catch (e) {
  parentPort.postMessage({ error: e.message });
}
