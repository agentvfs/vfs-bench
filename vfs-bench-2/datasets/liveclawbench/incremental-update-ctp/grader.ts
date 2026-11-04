import { PyFloat } from '../../../workspace/py.ts'
import { type Context, type Grade, round } from '../../../workspace/grader.ts'
import {
  canonicalizeSourceId,
  discoverSourceAliases,
  keyMatchesHints,
  normalizeSourceSet,
  pkbPrompt,
  sourceIdPatterns,
  sourceIdsOf,
  structuralScores,
} from '../graders/notes.ts'
import { type Dict, type Json, JudgeFailed, OUT, callJudge, isDict, isList, loadJson, plain, split, verdict, weightedSum } from '../graders/pkb.ts'

// Upstream's tests/llm_judge.py, its judge's instructions verbatim.
const SYSTEM_PROMPT = "You are a strict evaluator for a PKB benchmark case. Be critical — most work has flaws.\n\nScore only the semantic quality of the agent's work. Do not reward formatting, verbosity, or any specific JSON schema.\nDo not infer quality from field names or structure alone. Use only the actual content and reasoning.\n\nReturn JSON only with this shape:\n{\n  \"update_reasoning\": 0.0,\n  \"note_quality\": 0.0,\n  \"rationales\": {\n    \"update_reasoning\": \"...\",\n    \"note_quality\": \"...\"\n  }\n}\n\nScoring rules — be strict, 1.0 is rare and reserved for exceptional work:\n- Use a 0.0 to 1.0 scale in 0.25 increments.\n\n- `update_reasoning`: Does the agent correctly explain WHY each prior belief was preserved, updated, or removed? Check each decision independently:\n  1. PRESERVE exact distribution / draft-verify mechanism → must explain these are confirmed by all sources and remain foundational\n  2. UPDATE \"always requires separate draft model\" → must cite self-speculative methods (EAGLE, Medusa, layer skipping) as evidence\n  3. UPDATE \"high acceptance implies speedup\" → must explain that draft cost and system fit also matter\n  4. REMOVE \"cache-only shortcut\" framing → must explain this confuses an implementation detail with the core algorithm\n  Score by counting how many of these 4 decisions are correctly reasoned:\n  - 1.0: All 4 correct with specific evidence from corpus\n  - 0.75: 3 of 4 correct and well-reasoned\n  - 0.5: 2 of 4 correct and well-reasoned\n  - 0.25: 1 of 4 correct and well-reasoned\n  - 0.0: No meaningful delta reasoning\n\n- `note_quality`: Does the updated workspace note clearly capture the delta between prior and current understanding?\n  - 1.0: Note clearly distinguishes preserved vs updated vs removed beliefs. Each change is explained with corpus evidence. The note reads as a coherent, synthesized understanding, not a copy-paste of sources.\n  - 0.75: Note captures most changes but 1-2 are vaguely stated or the before/after distinction is unclear.\n  - 0.5: Note mentions some changes but does not clearly separate what was preserved from what was updated or removed. Generic reasoning.\n  - 0.25: Note is mostly a restatement of prior beliefs or a direct copy from sources with minimal synthesis.\n  - 0.0: No meaningful workspace note update.\n  Focus on durable workspace artifacts, not just `output/result.json`.\n"

const PRESERVE_HINTS = ['preserv', 'kept', 'keep', 'unchanged', 'still_valid', 'retain', 'confirmed', 'stable', 'correct', 'hold', 'solid']
const UPDATE_HINTS = ['updat', 'revis', 'narrow', 'chang', 'modif', 'refined', 'corrected', 'replaced', 'replacement', 'evolved', 'adjusted']
const REMOVE_HINTS = ['remov', 'delet', 'drop', 'discard', 'reject', 'invalid', 'wrong', 'obsolete', 'deprecated', 'retire', 'incorrect']

/** `_extract_text_from_value`: every string under a value, space-joined. */
function textOf(value: Json): string {
  if (typeof value === 'string') return value
  if (isList(value)) return value.map(textOf).join(' ')
  if (isDict(value)) return [...value.values()].map(textOf).join(' ')
  return ''
}

/** `extract_delta_texts`: the text under keys that sound preserved, updated or removed, in that order of precedence. */
function deltaTexts(result: Dict): [string, string, string] {
  const parts: [string[], string[], string[]] = [[], [], []]
  const walk = (obj: Json) => {
    if (isDict(obj)) {
      for (const [k, v] of obj) {
        const side = [PRESERVE_HINTS, UPDATE_HINTS, REMOVE_HINTS].findIndex((hints) => keyMatchesHints(k, hints))
        if (side < 0) walk(v)
        else {
          parts[side]!.push(textOf(v))
          if (isDict(v) || isList(v)) walk(v)
        }
      }
    } else if (isList(obj)) for (const item of obj) walk(item)
  }
  walk(result)
  return parts.map((p) => p.join(' ').toLowerCase()) as [string, string, string]
}

/** `delta_scores`: the answer key's concepts named under their side. */
function deltaScores(result: Dict, key: Dict) {
  const texts = deltaTexts(result)
  const concepts = key.get('delta_concepts') ?? new Map()
  const sides = ['preserve', 'update', 'remove'].map((s) => (isDict(concepts) ? concepts.get(s) : undefined) ?? new Map())
  const total = sides.reduce<number>((n, side) => n + (isDict(side) ? side.size : 0), 0)
  if (total === 0) return { delta_accuracy: new PyFloat(0) }
  let correct = 0
  sides.forEach((side, i) => {
    if (!isDict(side)) return
    for (const keywords of side.values())
      if (isList(keywords) && keywords.some((kw) => texts[i]!.includes(String(kw).toLowerCase()))) correct += 1
  })
  return { delta_accuracy: new PyFloat(round(correct / total, 4)) }
}

/** `extract_all_source_ids`: every source id under result.json's values. */
function allSourceIds(result: Dict, aliases: Map<string, string>): Set<string> {
  const ids = new Set<string>()
  const walk = (obj: Json) => {
    if (isDict(obj))
      for (const v of obj.values()) {
        for (const sid of sourceIdsOf(v)) ids.add(canonicalizeSourceId(sid, aliases))
        if (isDict(v) || isList(v)) walk(v)
      }
    else if (isList(obj))
      for (const item of obj) {
        if (typeof item === 'string') for (const sid of sourceIdsOf(item)) ids.add(canonicalizeSourceId(sid, aliases))
        else if (isDict(item) || isList(item)) walk(item)
      }
  }
  walk(result)
  return ids
}

/** `source_coverage_score`: the share of the answer key's evidence sources result.json names. */
function sourceCoverage(result: Dict, key: Dict, aliases: Map<string, string>) {
  const actual = allSourceIds(result, aliases)
  const expected = normalizeSourceSet(key.get('evidence_source_ids'), aliases)
  if (!expected.size) return { source_coverage: new PyFloat(0) }
  const covered = [...expected].filter((sid) => actual.has(sid)).length
  return { source_coverage: new PyFloat(round(covered / expected.size, 4)) }
}

/**
 * Upstream's llm_judge.py: the deterministic scores, the judge's two, the
 * rubric's weighted sum. A judge that fails zeroes its two and says so.
 */
export async function grader(c: Context): Promise<Grade> {
  const key = loadJson(c, '/tests/answer_key.json')
  const rubric = loadJson(c, '/tests/rubric.json')
  const result = loadJson(c, `${OUT}/result.json`)
  const aliases = discoverSourceAliases(c, sourceIdPatterns('any'))
  const structural = { ...structuralScores(c, result), ...deltaScores(result, key), ...sourceCoverage(result, key, aliases) }
  const prompt = pkbPrompt(c, key, result, structural, {
    beliefs: ['# Prior Beliefs To Correct', 'prior_beliefs_to_correct'],
    expectations: 'note_quality_expectations',
  })
  let payload: Dict = new Map(),
    debug: Record<string, unknown> = { mode: '', model: '' },
    failed = 0,
    error = ''
  try {
    ;[payload, debug] = (await callJudge(SYSTEM_PROMPT, prompt, c.input.env ?? {})) as [Dict, any]
  } catch (exc) {
    if (!(exc instanceof JudgeFailed)) throw exc
    error = Array.from(exc.message).slice(0, 500).join('')
    failed = 1
  }
  const score: Record<string, unknown> = {
    result_contract_valid: structural.result_contract_valid,
    delta_accuracy: structural.delta_accuracy,
    source_coverage: structural.source_coverage,
    workspace_update: structural.workspace_update,
    update_reasoning: verdict(payload, 'update_reasoning'),
    note_quality: verdict(payload, 'note_quality'),
    _meta_rationales: payload.get('rationales') ?? new Map(),
    _meta_judge_model: debug.model,
    _meta_judge_mode: debug.mode,
    _meta_judge_failed: failed,
    _meta_judge_error: error,
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
