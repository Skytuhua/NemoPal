import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { T3Runner } from './index';

export function createT3Runner(command = process.env.T3CODE_CLI_PATH ?? (process.platform === 'win32' ? join(homedir(), '.t3', 'bin', 't3.cmd') : 't3')): T3Runner {
  const batch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
  if (batch && (!isAbsolute(command) || /["&|<>^%!\r\n]/.test(command))) throw Error('T3 batch launcher requires an absolute path without shell metacharacters');
  return (args, input, signal) => new Promise((resolve, reject) => {
    // Batch launchers need cmd.exe; all arguments here are fixed words, a UUID, or a bounded integer. Message text stays on stdin.
    if (batch && args.some(arg => !/^[a-zA-Z0-9-]+$/.test(arg))) { reject(Error('Invalid T3 CLI argument')); return; }
    const child = execFile(batch ? 'cmd.exe' : command, batch ? ['/d', '/s', '/c', `""${command}" ${args.join(' ')}"`] : args, {
      windowsHide: true, windowsVerbatimArguments: batch, timeout: 15000, maxBuffer: 1024 * 1024, encoding: 'utf8', signal,
    }, (error, stdout) => {
      if (error) reject(Error('Local T3 CLI unavailable'));
      else resolve(stdout);
    });
    child.stdin?.on('error', () => {}); // The exit callback reports a failed pipe without logging message text.
    child.stdin?.end(input);
  });
}
