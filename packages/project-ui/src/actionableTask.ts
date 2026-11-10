import type { Project } from '@living-playbooks/contracts';

/** One owner-visible next action, even when old layout suggestions are complete or duplicated. */
export function actionableTask(project: Project) {
  for (const panel of project.workspace.panels) {
    if (panel.type !== 'next_action') continue;
    const task = project.tasks.find(item => item.id === panel.taskId && item.status !== 'done' && item.status !== 'skipped');
    if (task) return task;
  }
  return project.tasks.find(task => task.status === 'in_progress') ?? project.tasks.find(task => task.status === 'todo') ?? project.tasks.find(task => task.status === 'blocked');
}
