// ============================================================
// Service — gestionează serviciul launchd pe macOS
// ============================================================
// nova service install   → creează plist + încarcă cu launchctl
// nova service uninstall → descarcă + șterge plist
// nova service status    → verifică dacă rulează
//
// Pe Windows: afișează instrucțiuni manuale (Task Scheduler).
// Pe Linux:   afișează instrucțiuni pentru systemd.
// ============================================================

import { execSync, spawnSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';

const LABEL = 'com.novacortex.daemon';
const PLIST_DIR = join(homedir(), 'Library', 'LaunchAgents');
const PLIST_PATH = join(PLIST_DIR, `${LABEL}.plist`);

export async function cmdServiceInstall(): Promise<void> {
  if (platform() !== 'darwin') {
    printNonMacInstructions();
    return;
  }

  const projectDir = process.cwd();
  const nodeExec = process.execPath;
  const entryPoint = join(projectDir, 'src', 'index.ts');
  const logsDir = join(projectDir, 'logs');

  mkdirSync(PLIST_DIR, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodeExec}</string>
        <string>--experimental-strip-types</string>
        <string>${entryPoint}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${projectDir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logsDir}/daemon.log</string>
    <key>StandardErrorPath</key>
    <string>${logsDir}/daemon-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>`;

  writeFileSync(PLIST_PATH, plist);
  console.log(`Plist scris: ${PLIST_PATH}`);

  // Descărcăm versiunea veche dacă există
  spawnSync('launchctl', ['unload', PLIST_PATH], { stdio: 'ignore' });

  const result = spawnSync('launchctl', ['load', PLIST_PATH], { stdio: 'pipe' });
  if (result.status !== 0) {
    console.error('Eroare launchctl load:', result.stderr?.toString());
    process.exit(1);
  }

  console.log('\nServiciul Nova Cortex a fost instalat.');
  console.log('Daemonul pornește automat la login și se repornește dacă crashează.');
  console.log('\nLog-uri:');
  console.log(`  Stdout: ${logsDir}/daemon.log`);
  console.log(`  Stderr: ${logsDir}/daemon-error.log`);
  console.log('\nPentru a dezinstala: nova service uninstall');
}

export async function cmdServiceUninstall(): Promise<void> {
  if (platform() !== 'darwin') {
    console.log('Dezinstalare manuală necesară pe această platformă.');
    return;
  }

  if (!existsSync(PLIST_PATH)) {
    console.log('Serviciul nu e instalat.');
    return;
  }

  spawnSync('launchctl', ['unload', PLIST_PATH], { stdio: 'ignore' });
  unlinkSync(PLIST_PATH);
  console.log('Serviciu dezinstalat. Daemonul nu va mai porni automat la login.');
}

export function cmdServiceStatus(): void {
  if (platform() !== 'darwin') {
    console.log('Verificare status disponibilă doar pe macOS.');
    return;
  }

  const installed = existsSync(PLIST_PATH);
  console.log(`\nServiciu launchd: ${installed ? 'instalat' : 'neinstalat'}`);
  if (!installed) {
    console.log('Rulează "nova service install" pentru instalare.');
    return;
  }

  try {
    const out = execSync(`launchctl list | grep ${LABEL}`, { encoding: 'utf8' });
    const parts = out.trim().split(/\s+/);
    const pid = parts[0];
    const running = pid !== '-';
    console.log(`Status: ${running ? `rulează (PID: ${pid})` : 'oprit'}`);
  } catch {
    console.log('Status: oprit sau necunoscut');
  }

  console.log(`Plist: ${PLIST_PATH}`);
}

function printNonMacInstructions(): void {
  const os = platform();
  if (os === 'win32') {
    console.log(`
Windows — rulare automată la login:
  1. Deschide Task Scheduler
  2. Create Basic Task → "Nova Cortex"
  3. Trigger: "When I log on"
  4. Action: Start a program
     Program: node
     Arguments: --experimental-strip-types src/index.ts
     Start in: ${process.cwd()}
`);
  } else {
    console.log(`
Linux — serviciu systemd (user):
  mkdir -p ~/.config/systemd/user/
  cat > ~/.config/systemd/user/nova-cortex.service << EOF
  [Unit]
  Description=Nova Cortex Daemon

  [Service]
  ExecStart=${process.execPath} --experimental-strip-types ${join(process.cwd(), 'src/index.ts')}
  WorkingDirectory=${process.cwd()}
  Restart=always

  [Install]
  WantedBy=default.target
  EOF

  systemctl --user enable --now nova-cortex
`);
  }
}
