/**
 * DataSpace (HKUSTDial/DataSpace, MIT): analytical questions over a
 * task-local workspace of CSV, JSON, SQLite, Markdown, PDF and video,
 * answered as a CSV table.
 *
 * The task's `context/` is mounted read-only at `/workspace` and the agent
 * writes `/output/prediction.csv`, the paths upstream's smolagents harness
 * uses, under upstream's own user prompt (`relation_task_prompt`, contract
 * relation-v2). `/opt/dataspace/TOOLS.md` describes this workspace's tools
 * in place of upstream's Docker workbench. Upstream's evaluator grades the
 * CSV against the public gold answer. Setup: `python3 -I dataspace/setup.py`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { STATE } from '../harness/paths.ts'
import { runPython } from '../harness/python.ts'
import { type Task, graded } from '../harness/task.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const BENCHMARK = join(STATE, 'dataspace', 'benchmark')

/** Upstream's `relation_task_prompt`, verbatim. */
function prompt(taskId: string, question: string, workspacePath: string, outputPath: string): string {
  return `Task ID: ${taskId}

Question:
${question}

All task input artifacts are located under:
${workspacePath}

Solve the task using only those artifacts. Internet access is unavailable.
The preinstalled generic data-processing utilities are documented at
/opt/dataspace/TOOLS.md. Package installation is unavailable.
Write the complete requested relation to:
${outputPath}

The answer must be a rectangular UTF-8 CSV with one header row. A header-only
CSV is valid when the requested result is empty. Return all requested rows and
columns; do not replace the CSV with a prose answer.

Do not finish the task until the exact file path above exists. Before ending,
verify that its filename is exactly prediction.csv, that it is readable as a
rectangular CSV, and that it contains the complete final relation. A prose
response or a differently named file does not count as submission. Once the
verified prediction.csv is ready, terminate the session.`
}

export async function load(slug: string): Promise<Task> {
  const dir = join(HERE, slug)
  const { task_id: taskId } = JSON.parse(readFileSync(join(dir, 'task.json'), 'utf8')) as { task_id: string }
  const input = join(BENCHMARK, 'input', taskId)
  const { question } = JSON.parse(readFileSync(join(input, 'task.json'), 'utf8')) as { question: string }
  return {
    slug,
    dir,
    instruction: prompt(taskId, question, '/workspace', '/output/prediction.csv'),
    fakes: () => [],
    async seed(run) {
      run.env.DATASPACE_CONTEXT = join(input, 'context')
      run.env.DATASPACE_OUTPUT = run.path('output')
      run.env.DATASPACE_WORKBENCH = join(HERE, 'workbench')
      return null
    },
    snapshot: async () => null,
    async grade({ run }) {
      const result = (await runPython(HERE, join(HERE, 'grade.py'), {
        evaluator: join(STATE, 'dataspace', 'evaluate.py'),
        config: join(BENCHMARK, 'evaluation', 'configs', `${taskId}.json`),
        prediction: join(run.path('output'), 'prediction.csv'),
        gold: join(BENCHMARK, 'output', taskId, 'gold.csv'),
      })) as { passed: boolean; error_code: string | null; error: string | null; column_mapping: unknown }
      return graded([
        {
          name: 'prediction.csv equals the gold relation (upstream evaluator)',
          passed: result.passed,
          detail: JSON.stringify(result),
        },
      ])
    },
  }
}
