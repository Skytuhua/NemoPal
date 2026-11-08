import * as c from '@living-playbooks/contracts';
export function validateProposal(raw: unknown, job: c.ManagerJob, context: c.AuthorizedProjectContext): c.ManagerProposal {
    const parsed = c.ManagerProposalSchema.safeParse(raw);
    if (!parsed.success)
        throw new Error('proposal_contract');
    const proposal = parsed.data;
    const s = context.snapshot;
    const project = structuredClone(s.project);
    if (proposal.jobId !== job.id || proposal.baseProjectRevision !== job.baseProjectRevision || proposal.projectEpoch !== job.projectEpoch || project.id !== job.projectId)
        throw new Error('proposal_scope');
    if (c.canonicalJson([...proposal.grantVersions].sort((a, b) => a.bindingId.localeCompare(b.bindingId))) !== c.canonicalJson([...context.grantVersions].sort((a, b) => a.bindingId.localeCompare(b.bindingId))))
        throw new Error('proposal_grants');
    const evidence = new Map(s.observations.filter(o => s.sourceBindings.some(b => b.id === o.bindingId && b.state === 'following' && b.exportPolicy !== 'off' && b.grantRevision === o.grantRevision)).map(o => [o.id, o]));
    const checkRefs = (refs: string[]) => { if (refs.some(id => !evidence.has(id)))
        throw new Error('proposal_evidence'); };
    const evidenceLevel = (level: c.EvidenceLevel, refs: string[]) => {
        checkRefs(refs);
        if (level === 'user_reported')
            throw new Error('proposal_owner_authority');
        if (level === 'none' && refs.length)
            throw new Error('proposal_evidence');
        if (level !== 'none' && (!refs.length || refs.some(id => evidence.get(id)!.provenance.evidenceLevel !== level)))
            throw new Error('proposal_evidence_level');
    };
    const changed = new Set<string>();
    for (const change of proposal.taskChanges) {
        const id = change.type === 'create' ? change.task.id : change.taskId;
        if (changed.has(id))
            throw new Error('proposal_duplicate_task');
        changed.add(id);
        if (change.type === 'create') {
            if (project.tasks.some(t => t.id === id))
                throw new Error('proposal_task_identity');
            evidenceLevel(change.task.evidenceLevel, change.task.evidenceIds);
            if (['done', 'skipped'].includes(change.task.status))
                throw new Error('proposal_completion_authority');
            project.tasks.push({ ...change.task, revision: 0, ownerOverride: false });
        }
        else {
            const task = project.tasks.find(t => t.id === id);
            if (!task || task.revision !== change.expectedRevision)
                throw new Error('proposal_task_revision');
            if (task.ownerOverride)
                throw new Error('proposal_owner_override');
            evidenceLevel(change.evidenceLevel, change.evidenceIds);
            if (change.status && ['done', 'skipped'].includes(change.status))
                throw new Error('proposal_completion_authority');
            Object.assign(task, { ...(change.status ? { status: change.status } : {}), ...(change.title ? { title: change.title } : {}), evidenceLevel: change.evidenceLevel, evidenceIds: change.evidenceIds, revision: task.revision + 1 });
        }
    }
    checkRefs(proposal.reply.observationIds);
    for (const d of proposal.decisionSuggestions)
        checkRefs(d.observationIds);
    project.workspace = proposal.workspace;
    const candidate = { ...s, project };
    if (!c.ProjectSnapshotSchema.safeParse(candidate).success)
        throw new Error('proposal_component_references');
    if (proposal.questionSuggestion) {
        const q = proposal.questionSuggestion;
        const task = project.tasks.find(t => t.id === q.taskId);
        if (!task || task.revision !== q.subjectRevision || ['done', 'skipped'].includes(task.status))
            throw new Error('proposal_question_subject');
    }
    if (proposal.codexTask && !project.tasks.some(task => task.id === proposal.codexTask!.taskId && !['done', 'skipped'].includes(task.status)))
        throw new Error('proposal_codex_task');
    return proposal;
}
