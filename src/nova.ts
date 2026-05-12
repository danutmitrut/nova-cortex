// ============================================================
// Nova Cortex CLI — entry point
// ============================================================
// Rulare: node --experimental-strip-types src/nova.ts <cmd>
// Sau: npm run nova -- <cmd>
//
// Comenzi: status | start | stop | bus
// ============================================================

import { cmdStatus, cmdStart, cmdStop, cmdBus, cmdHelp } from './cli/commands.ts';

const [, , command, ...args] = process.argv;

async function main() {
  switch (command) {
    case 'status':
      await cmdStatus();
      break;
    case 'start':
      await cmdStart(args[0]);
      break;
    case 'stop':
      await cmdStop(args[0]);
      break;
    case 'bus':
      await cmdBus(args[0], args.slice(1).join(' '));
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      cmdHelp();
      break;
    default:
      console.error(`Comandă necunoscută: "${command}". Încearcă "nova help".`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
