import { ProjectSnapshotSchema, type ProjectSnapshot, type WorkspaceSpec } from '@living-playbooks/contracts';
export function validateSnapshot(raw: ProjectSnapshot, previous?: WorkspaceSpec): { snapshot: ProjectSnapshot; rejected: boolean } {
  const valid = ProjectSnapshotSchema.safeParse(raw);
  if (valid.success) return { snapshot: valid.data, rejected: false };
  // Re-validate every canonical record after removing only the untrusted layout.
  const fallback = ProjectSnapshotSchema.parse({ ...raw, project: { ...raw.project, workspace: { schemaVersion: 1, id: raw.project.workspace.id, revision: 0, panels: [{ id: raw.project.workspace.id, type: 'checklist', heading: 'Tasks', taskIds: raw.project.tasks.map(task => task.id) }] } } });
  if (previous) {
    const retained = ProjectSnapshotSchema.safeParse({ ...fallback, project: { ...fallback.project, workspace: previous } });
    if (retained.success) return { snapshot: retained.data, rejected: true };
  }
  return { snapshot: fallback, rejected: true };
}
