import type { PlaybooksClient } from '@living-playbooks/contracts';

/** Reject unconfigured or unsafe destinations before they reach pairing or transport. */
export function desktopOrigin(raw: string | undefined, packaged: boolean): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && !packaged)) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    // Renderer pairing accepts an origin, not a URL with a slash or default port.
    return url.origin;
  } catch { return null; }
}

/** A real unavailable state: never forwards requests or credentials to a placeholder destination. */
export function unavailableDesktopClient(): PlaybooksClient {
  const unavailable = async (): Promise<never> => { throw Error('Desktop API origin unavailable'); };
  return {
    listProjects: unavailable, createProject: unavailable, getSnapshot: unavailable,
    getPhoneStatus: unavailable, linkPhone: unavailable, revokePhone: unavailable,
    sendMessage: unavailable, applyAction: unavailable, saveDocument: unavailable,
    answerCheckIn: unavailable, snoozeCheckIn: unavailable, cancelCheckIn: unavailable,
    presentCheckIn: unavailable, enrollSource: unavailable, setSourceState: unavailable,
    revokeSource: unavailable, ingestObservations: unavailable, reportSourceHealth: unavailable,
    deleteProject: unavailable, cancelJob: unavailable, subscribe: unavailable,
  };
}
