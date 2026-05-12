// ============================================================
// Nova Cortex — Entry Point
// ============================================================
// Pornește daemonul principal.
// Rulare: node --experimental-strip-types src/index.ts
// ============================================================

import { Daemon } from './daemon/daemon.ts';

const daemon = new Daemon('./agents', './state');
daemon.start();
