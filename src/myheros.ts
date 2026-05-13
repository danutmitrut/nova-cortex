// ============================================================
// My HerOS CLI — entry point
// ============================================================
// Rulare: node --experimental-strip-types src/myheros.ts <cmd>
// Sau: npm run myheros -- <cmd>
//
// Comenzi: status | start | stop | bus
// ============================================================

import { cmdStatus, cmdStart, cmdStop, cmdBus, cmdDoctor, cmdHelp, cmdAddAgent, cmdListTemplates, cmdEnable, cmdDisable, cmdHeartbeats, cmdCommunity, cmdImport, cmdLogs, cmdReport, cmdKnowledge, cmdChat } from './cli/commands.ts';
import { cmdServiceInstall, cmdServiceUninstall, cmdServiceStatus } from './cli/service.ts';
import { cmdTunnel } from './cli/tunnel.ts';
import { cmdSetup } from './cli/setup.ts';

const [, , command, ...args] = process.argv;

async function main() {
  switch (command) {
    case 'setup':
      await cmdSetup();
      break;
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
    case 'doctor':
      await cmdDoctor();
      break;
    case 'add-agent':
      cmdAddAgent(args[0], args.includes('--template') ? args[args.indexOf('--template') + 1] : undefined);
      break;
    case 'list-templates':
      cmdListTemplates();
      break;
    case 'enable':
      await cmdEnable(args[0]);
      break;
    case 'disable':
      await cmdDisable(args[0]);
      break;
    case 'heartbeats':
      await cmdHeartbeats();
      break;
    case 'community':
      cmdCommunity();
      break;
    case 'import':
      cmdImport(args[0]);
      break;
    case 'tunnel':
      await cmdTunnel(args[0]);
      break;
    case 'logs':
      await cmdLogs(args[0]);
      break;
    case 'report':
      cmdReport(args[0]);
      break;
    case 'knowledge':
      cmdKnowledge(args[0], args[1]);
      break;
    case 'chat':
      await cmdChat(args[0], args.slice(1).join(' '));
      break;
    case 'service':
      switch (args[0]) {
        case 'install':   await cmdServiceInstall(); break;
        case 'uninstall': await cmdServiceUninstall(); break;
        case 'status':    cmdServiceStatus(); break;
        default: console.error('Utilizare: myheros service install|uninstall|status'); process.exit(1);
      }
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      cmdHelp();
      break;
    default:
      console.error(`Comandă necunoscută: "${command}". Încearcă "myheros help".`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
