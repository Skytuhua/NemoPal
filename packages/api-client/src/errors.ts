import type { ApiError } from '@living-playbooks/contracts';

export class ClientError extends Error {
  readonly retryable?: boolean;
  readonly currentRevision?: number;
  readonly capability?: ApiError['capability'];
  constructor(public readonly code: string, message: string, public readonly status?: number, metadata?: Pick<ApiError, 'retryable' | 'currentRevision' | 'capability'>) {
    super(message);
    this.name = 'ClientError';
    this.retryable = metadata?.retryable;
    this.currentRevision = metadata?.currentRevision;
    this.capability = metadata?.capability;
  }
}

export class CursorExpiredError extends ClientError {
  constructor() {
    super('cursor_expired', 'The event cursor expired. Refresh authorized snapshots before reconnecting.');
    this.name = 'CursorExpiredError';
  }
}

export class FixtureUnavailableError extends ClientError {
  constructor() {
    super('fixture_unavailable', 'This operation is unavailable in the explicit fixture client.');
    this.name = 'FixtureUnavailableError';
  }
}
