/**
 * What vendor-due-diligence-brief's and pre-meeting-research-brief's
 * verifiers share: their deterministic_checks.py's anchors, and their
 * llm_judge.py's prompt, the context it fetches from the task's mock
 * between the scores and the corpus.
 */
import { PyFloat } from '../../../workspace/py.ts'
import { type Context, type Grade, round } from '../../../workspace/grader.ts'
import {
  type Dict,
  type Json,
  OUT,
  ROOT,
  basename,
  callJudge,
  children,
  dumps,
  isDict,
  isFile,
  isList,
  iter,
  loadJson,
  plain,
  readText,
  split,
  strip,
  truthy,
  verdict,
  weightedSum,
} from './pkb.ts'

/** `result_as_text`: every string in result.json, space-joined, lower-cased. */
export function resultText(result: Dict): string {
  const parts: string[] = []
  const walk = (obj: Json) => {
    if (typeof obj === 'string') parts.push(obj)
    else if (isList(obj)) obj.forEach(walk)
    else if (isDict(obj)) for (const v of obj.values()) walk(v)
  }
  walk(result)
  return parts.join(' ').toLowerCase()
}

/** `structural_valid`: a result.json with each field the key requires. */
export const structurallyValid = (result: Dict, key: Dict) =>
  new PyFloat(truthy(result) && iter(key.get('required_fields') ?? []).every((f) => typeof f === 'string' && result.has(f)) ? 1 : 0)

/** A list field of at least `min` items. */
export function listOf(result: Dict, field: string, min: Json): boolean {
  const v = result.get(field)
  return isList(v) && v.length >= Number(min)
}

/** `anchor_scores`: the share of the key's anchors result.json's text holds. */
export function anchorScores(result: Dict, key: Dict) {
  const anchors = key.get('anchors') ?? []
  if (!truthy(anchors)) return { anchor_coverage: new PyFloat(0) }
  const text = resultText(result)
  const items = iter(anchors)
  const hits = items.filter((anchor) => text.includes(String(anchor).toLowerCase())).length
  return { anchor_coverage: new PyFloat(round(hits / items.length, 4)) }
}

/**
 * The two judges' `main`: the deterministic scores, the judge's three
 * dimensions, the rubric's weighted sum. A judge that fails fails the
 * grade, as upstream's llm_judge.py then writes no reward.
 */
export async function briefGrade(
  c: Context,
  system: string,
  deterministic: (result: Dict, key: Dict) => Record<string, PyFloat>,
  context: [string, string],
  dimensions: string[]
): Promise<Grade> {
  const key = loadJson(c, '/tests/answer_key.json')
  const rubric = loadJson(c, '/tests/rubric.json')
  const result = loadJson(c, `${OUT}/result.json`)
  const scores = deterministic(result, key)
  const corpus = `${ROOT}/corpus`
  const sections = children(c, corpus)
    .filter((f) => isFile(c, f))
    .map((f) => `### ${basename(f)}\n${strip(readText(c, f)) || '(empty)'}`)
  const prompt =
    strip(
      [
        '# Task Instruction',
        strip(readText(c, `${ROOT}/instruction.md`)) || '(missing instruction)',
        '',
        '# Deterministic Check Results',
        dumps(scores),
        '',
        context[0],
        context[1],
        '',
        '# Corpus Materials Available to Agent',
        sections.length ? sections.join('\n\n') : '(none)',
        '',
        '# Agent result.json',
        dumps(result),
      ].join('\n')
    ) + '\n'
  const [payload, debug] = await callJudge(system, prompt, c.input.env ?? {}, '')
  const score: Record<string, unknown> = {
    ...scores,
    ...Object.fromEntries(dimensions.map((d) => [d, verdict(payload, d)])),
    _meta_rationales: payload.get('rationales') ?? new Map(),
    _meta_judge_model: debug.model,
    _meta_judge_mode: debug.mode,
  }
  score.reward = weightedSum(score, rubric)
  const [rewards, details] = split(score)
  return {
    score: rewards.reward!,
    checks: rewards,
    rewards: { reward: rewards.reward!, ...rewards },
    artifacts: { 'reward_details.json': details, 'llm_judge.json': { prompt, response: plain(debug) } },
  }
}
