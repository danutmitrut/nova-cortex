// ============================================================
// Service — gestionează serviciul launchd pe macOS
// ============================================================
// myheros service install   → creează plist + încarcă cu launchctl
// myheros service uninstall → descarcă + șterge plist
// myheros service status    → verifică dacă rulează
//
// Pe Windows: afișează instrucțiuni manuale (Task Scheduler).
// Pe Linux:   afișează instrucțiuni pentru systemd.
// ============================================================

import { execSync, spawnSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';

const LABEL = 'com.myheros.daemon';
const PLIST_DIR = join(homedir(), 'Library', 'LaunchAgents');
const PLIST_PATH = join(PLIST_DIR, `${LABEL}.plist`);

export async function cmdServiceInstall(): Promise<void> {
  if (platform() === 'win32') return installWindows();
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

  console.log('\nServiciul My HerOS a fost instalat.');
  console.log('Daemonul pornește automat la login și se repornește dacă crashează.');
  console.log('\nLog-uri:');
  console.log(`  Stdout: ${logsDir}/daemon.log`);
  console.log(`  Stderr: ${logsDir}/daemon-error.log`);
  console.log('\nPentru a dezinstala: myheros service uninstall');
}

export async function cmdServiceUninstall(): Promise<void> {
  if (platform() === 'win32') return uninstallWindows();
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
  if (platform() === 'win32') return statusWindows();
  if (platform() !== 'darwin') {
    console.log('Verificare status disponibilă doar pe macOS.');
    return;
  }

  const installed = existsSync(PLIST_PATH);
  console.log(`\nServiciu launchd: ${installed ? 'instalat' : 'neinstalat'}`);
  if (!installed) {
    console.log('Rulează "myheros service install" pentru instalare.');
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

// ── Windows Task Scheduler ───────────────────────────────────
const WIN_TASK = 'MyHerOS';

function installWindows(): void {
  const projectDir = process.cwd();
  const nodeExec = process.execPath;
  const entryPoint = join(projectDir, 'src', 'index.ts');
  const logsDir = join(projectDir, 'logs');

  mkdirSync(logsDir, { recursive: true });

  // Wrapper VBScript — pornește node fără fereastră consolă
  const vbsPath = join(projectDir, 'myheros-daemon.vbs');
  writeFileSync(vbsPath,
    `Set WshShell = CreateObject("WScript.Shell")\r\n` +
    `WshShell.Run """${nodeExec}"" --experimental-strip-types ""${entryPoint}""", 0, False\r\n`
  );

  // Înregistrează task-ul: rulează la login, fără consolă
  const cmd = [
    'schtasks', '/create',
    '/tn', WIN_TASK,
    '/tr', `wscript.exe "${vbsPath}"`,
    '/sc', 'ONLOGON',
    '/rl', 'HIGHEST',
    '/f',
  ].join(' ');

  const r = spawnSync('cmd', ['/c', cmd], { stdio: 'pipe', cwd: projectDir });
  if (r.status !== 0) {
    console.error('Eroare Task Scheduler:', r.stderr?.toString() || r.stdout?.toString());
    process.exit(1);
  }

  console.log(`\nTask "${WIN_TASK}" înregistrat în Task Scheduler.`);
  console.log('Daemonul va porni automat la următorul login.');
  console.log('\nPornire imediată (fără restart):');
  console.log(`  schtasks /run /tn ${WIN_TASK}`);
  console.log('\nPentru a dezinstala: myheros service uninstall');
}

function uninstallWindows(): void {
  const r = spawnSync('schtasks', ['/delete', '/tn', WIN_TASK, '/f'], { stdio: 'pipe', shell: true });
  if (r.status === 0) {
    console.log(`Task "${WIN_TASK}" șters din Task Scheduler.`);
  } else {
    const msg = r.stderr?.toString() || '';
    if (msg.includes('cannot find')) {
      console.log('Task-ul nu era instalat.');
    } else {
      console.error('Eroare:', msg);
    }
  }
}

function statusWindows(): void {
  const r = spawnSync('schtasks', ['/query', '/tn', WIN_TASK, '/fo', 'LIST'], { stdio: 'pipe', shell: true });
  if (r.status !== 0) {
    console.log(`Task "${WIN_TASK}": neinstalat. Rulează "myheros service install".`);
    return;
  }
  const lines = r.stdout.toString().split('\n').filter(l => /Status|Task To Run|Next Run/i.test(l));
  console.log(`\nTask Scheduler — ${WIN_TASK}:`);
  for (const l of lines) console.log(' ', l.trim());
  console.log('');
}

function printNonMacInstructions(): void {
  console.log(`
Linux — serviciu systemd (user):
  mkdir -p ~/.config/systemd/user/
  cat > ~/.config/systemd/user/my-heros.service << EOF
  [Unit]
  Description=My HerOS Daemon

  [Service]
  ExecStart=${process.execPath} --experimental-strip-types ${join(process.cwd(), 'src/index.ts')}
  WorkingDirectory=${process.cwd()}
  Restart=always

  [Install]
  WantedBy=default.target
  EOF

  systemctl --user enable --now my-heros
`);
}
