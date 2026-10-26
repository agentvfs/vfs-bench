/** Open a task's Mirage workspace from its `workspace.yaml`. */
import { Workspace, configToWorkspaceArgs, loadWorkspaceConfigFile } from '@struktoai/mirage-node'

/**
 * A workspace built from `workspace.yaml`. The caller closes it.
 *
 * Args:
 *   yamlPath: the task's workspace.yaml.
 *   env: values for its `${VAR}` references, on top of the process
 *     environment.
 */
export async function openWorkspace(yamlPath: string, env: Record<string, string>): Promise<Workspace> {
  const merged = { ...(process.env as Record<string, string>), ...env }
  const args = await configToWorkspaceArgs(loadWorkspaceConfigFile(yamlPath, merged))
  return new Workspace(args.mounts, args.options)
}
