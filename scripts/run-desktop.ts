import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { buildDesktop } from './build';

await buildDesktop();
const electronBinary = createRequire(import.meta.url)('electron') as string;
const desktopEnvironment = { ...process.env };
delete desktopEnvironment.ELECTRON_RUN_AS_NODE;
const child = spawn(electronBinary, ['apps/desktop'], { stdio: 'inherit', env: desktopEnvironment, windowsHide: false });
child.on('error', () => { console.error('Desktop failed to start. Verify the Electron binary and renderer configuration.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
