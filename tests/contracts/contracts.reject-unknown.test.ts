import { describe, expect, it } from 'vitest';
import * as c from '../../packages/contracts/src/index';
import { goldenObservation } from '../../fixtures/contracts/golden';

describe('strict trust boundaries', () => {
  it('rejects generated scripts, unknown component types, and extra authority', () => {
    expect(c.WorkspaceSpecSchema, 'workspace validator is required').toBeDefined();
    const workspace = { schemaVersion: 1, id: crypto.randomUUID(), revision: 0, panels: [] };
    expect(c.WorkspaceSpecSchema.safeParse({ ...workspace, script: 'exec()' }).success).toBe(false);
    expect(c.WorkspaceSpecSchema.safeParse({ ...workspace, panels: [{ id: crypto.randomUUID(), type: 'shell', heading: 'Run' }] }).success).toBe(false);
    expect(c.WorkspaceSpecSchema.safeParse(workspace).success).toBe(true);
  });

  it('rejects privilege-bearing action names and owner fields', () => {
    expect(c.OwnerActionSchema, 'owner action validator is required').toBeDefined();
    expect(c.OwnerActionSchema.safeParse({ type: 'exec', command: 'whoami' }).success).toBe(false);
    expect(c.CreateProjectInputSchema.safeParse({ title: 'Demo', brief: 'Build it', ownerId: crypto.randomUUID() }).success).toBe(false);
    expect(c.OwnerActionSchema.safeParse({ type: 'accept_plan' }).success).toBe(true);
  });

  it('enforces UTF-8 byte limits rather than JavaScript character count', () => {
    expect(c.CreateProjectInputSchema, 'bounded brief validator is required').toBeDefined();
    expect(c.CreateProjectInputSchema.safeParse({ title: 'Demo', brief: 'a'.repeat(65536) }).success).toBe(true);
    expect(c.CreateProjectInputSchema.safeParse({ title: 'Demo', brief: '界'.repeat(22000) }).success).toBe(false);
    expect(c.CreateProjectInputSchema.safeParse({ title: 'Demo', brief: '', format: 'pdf' }).success).toBe(false);
  });

  it('rejects local source fields and raw command output on cloud ingestion', () => {
    expect(c.IngestObservationsInputSchema, 'cloud observation validator is required').toBeDefined();
    expect(c.IngestObservationsInputSchema.safeParse({ observations: [goldenObservation] }).success).toBe(true);
    expect(c.IngestObservationsInputSchema.safeParse({ observations: [goldenObservation], cursor: { offset: 123 } }).success).toBe(false);
    expect(c.IngestObservationsInputSchema.safeParse({ observations: [goldenObservation], path: 'C:\\private' }).success).toBe(false);
    expect(c.ObservationMetadataSchema.safeParse({ type: 'tool', exitCode: 0, stdout: 'secret' }).success).toBe(false);
    expect(c.ObservationMetadataSchema.safeParse({ type: 'tool', exitCode: 0 }).success).toBe(true);
  });
});
