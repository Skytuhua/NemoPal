import { createFixtureClient, type PlaybooksClient } from '@living-playbooks/api-client';
import { AllowedClientCommandSchema, EmptyInputSchema, SafeDesktopEventSchema, revisionedCommandSchema, type AllowedClientCommand, type DesktopBridge, type DesktopCommandResult } from '@living-playbooks/contracts';
import { shellDemo } from './shell-demo';

function desktopClient(bridge: DesktopBridge): PlaybooksClient {
  async function invoke<C extends AllowedClientCommand>(input: C): Promise<DesktopCommandResult<C>> {
    AllowedClientCommandSchema.parse(input);
    return bridge.invoke(input);
  }
  const consentOnly = async (): Promise<never> => { throw new Error('This operation requires desktop consent or main-process authority.'); };
  return {
    listProjects: () => invoke({ type: 'listProjects' }),
    getSnapshot: projectId => invoke({ type: 'getSnapshot', projectId }),
    getPhoneStatus: projectId => invoke({ type: 'getPhoneStatus', projectId }),
    linkPhone: (projectId, command) => invoke({ type: 'linkPhone', projectId, command }),
    revokePhone: (projectId, command) => invoke({ type: 'revokePhone', projectId, command }),
    createProject: command => invoke({ type: 'createProject', command }),
    sendMessage: (projectId, command) => invoke({ type: 'sendMessage', projectId, command }),
    applyAction: (projectId, command) => invoke({ type: 'applyAction', projectId, command }),
    saveDocument: (projectId, documentId, command) => invoke({ type: 'saveDocument', projectId, documentId, command }),
    answerCheckIn: (checkInId, command) => invoke({ type: 'answerCheckIn', checkInId, command }),
    snoozeCheckIn: (checkInId, command) => invoke({ type: 'snoozeCheckIn', checkInId, command }),
    cancelCheckIn: (checkInId, command) => invoke({ type: 'cancelCheckIn', checkInId, command }),
    deleteProject: (projectId, command) => invoke({ type: 'deleteProject', projectId, command }),
    cancelJob: async (jobId, command) => invoke({ type: 'cancelJob', jobId, command: revisionedCommandSchema(EmptyInputSchema).parse(command) }),
    enrollSource: consentOnly, setSourceState: consentOnly, revokeSource: consentOnly,
    ingestObservations: consentOnly, reportSourceHealth: consentOnly, presentCheckIn: consentOnly,
    async subscribe(after, onEvent, signal) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      await new Promise<void>((_resolve, reject) => {
        let sequence = after;
        const unsubscribe = bridge.onEvent(raw => {
          const parsed = SafeDesktopEventSchema.safeParse(raw);
          if (!signal.aborted && parsed.success && parsed.data.type === 'project_event' && parsed.data.event.seq > sequence) {
            sequence = parsed.data.event.seq; onEvent(parsed.data.event);
          }
        });
        const stop = () => { unsubscribe(); signal.removeEventListener('abort', stop); reject(new DOMException('Aborted', 'AbortError')); };
        signal.addEventListener('abort', stop, { once: true });
        if (signal.aborted) stop();
      });
    },
  };
}
export function runtime(bridge: DesktopBridge | undefined, development: boolean, fixtureEnabled: boolean): { client?: PlaybooksClient; fixture: boolean } {
  if (bridge) return { client: desktopClient(bridge), fixture: false };
  if (development && fixtureEnabled) return { client: createFixtureClient({ snapshots: [shellDemo()] }), fixture: true };
  return { fixture: false };
}
