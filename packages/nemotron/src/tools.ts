import * as c from '@living-playbooks/contracts';
export function executeReadTool(raw: unknown, context: c.AuthorizedProjectContext): unknown {
    const parsed = c.ReadToolCallSchema.safeParse(raw);
    if (!parsed.success)
        throw new Error('tool_contract');
    const tool = parsed.data;
    const s = context.snapshot;
    const permitted = s.observations.filter(o => {
        const binding = s.sourceBindings.find(b => b.id === o.bindingId);
        return binding && binding.state === 'following' && binding.exportPolicy !== 'off' && binding.grantRevision === o.grantRevision && context.grantVersions.some(g => g.bindingId === binding.id && g.grantRevision === binding.grantRevision);
    });
    switch (tool.name) {
        case 'read_project_state': return { project: s.project, checkIns: s.checkIns, sourceHealth: s.sourceBindings.map(b => ({ id: b.id, state: b.state, capability: b.capability, lastObservedAt: b.lastObservedAt })) };
        case 'list_recent_evidence': return permitted.map(({ id, kind, observedAt, provenance }) => ({ id, kind, observedAt, provenance }));
        case 'read_evidence': {
            const evidence = permitted.find(o => o.id === tool.arguments.observationId);
            if (!evidence)
                throw new Error('tool_scope');
            return evidence;
        }
        case 'read_project_document': {
            const doc = s.documents.find(d => d.id === tool.arguments.documentId);
            if (!doc)
                throw new Error('tool_scope');
            return doc;
        }
    }
}
