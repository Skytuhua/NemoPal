export class DomainError extends Error {
    constructor(public status: number, public code: string, message: string, public currentRevision?: number) { super(message); }
}
export function reject(status: number, code: string, message: string, revision?: number): never { throw new DomainError(status, code, message, revision); }
export function revision(actual: number, expected?: number) {
    if (actual !== expected)
        reject(409, 'revision_conflict', 'Refresh current state before retrying.', actual);
}
