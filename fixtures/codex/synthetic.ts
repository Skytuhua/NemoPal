// Synthetic installed-protocol examples. These are never live-observation evidence.
import { goldenBinding } from '../contracts/golden';
export const selectedThread = '019aa000-0000-7000-8000-000000000001';
export const localBinding = { binding: { ...goldenBinding, adapterId: 'codex-app-server', adapterVersion: '0.166.0', exportPolicy: 'approved_excerpts' as const, capability: 'incremental_history' as const, state: 'following' as const }, selectedSource: selectedThread, sourceIdentity: 'C:\\synthetic-project', localReadConsented: true as const };
export const metadata = { thread: { id: selectedThread, cwd: 'C:\\synthetic-project', createdAt: 1794050000, sessionId: selectedThread, cliVersion: '0.166.0', turns: [] } };
export const turn = (id: string, items: unknown[], status = 'completed') => ({ id, items, status, itemsView: 'full', startedAt: 1794050000, completedAt: status === 'completed' ? 1794050001 : null });
export const finalMessage = { id: 'message-final', type: 'agentMessage', text: 'Synthetic build passed.', phase: 'final_answer', completedAtMs: 1794050001000 };
export const secretMessage = { ...finalMessage, id: 'secret', text: 'token=top-secret-value sk-test012345678901234567890123456' };
export const hidden = { id: 'hidden', type: 'reasoning', summary: ['PRIVATE REASONING'], content: ['NEVER EXPORT'] };
export const command = { id: 'command', type: 'commandExecution', command: 'secret arguments', cwd: 'C:\\synthetic-project', commandActions: [], status: 'completed', exitCode: 0, aggregatedOutput: 'RAW SECRET OUTPUT' };
