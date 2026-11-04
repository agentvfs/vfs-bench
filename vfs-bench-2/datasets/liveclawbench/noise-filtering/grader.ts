import type { Context, Grade } from '../../../workspace/grader.ts'
import { discoverSourceAliases, pkbPrompt, sourceIdPatterns, sourceScores, structuralScores } from '../graders/notes.ts'
import { type Dict, JudgeFailed, OUT, callJudge, loadJson, plain, split, verdict, weightedSum } from '../graders/pkb.ts'

// Upstream's tests/llm_judge.py, its judge's instructions verbatim.
const SYSTEM_PROMPT = "You are a strict evaluator for a PKB benchmark case. Be critical — most work has flaws.\n\nScore only the semantic quality of the agent's work. Do not reward formatting, verbosity, or any specific JSON schema.\nDo not infer source quality from file names, ids, or titles. Use only the document contents and how well the agent handled conflicting evidence.\n\nReturn JSON only with this shape:\n{\n  \"reason_quality\": 0.0,\n  \"memory_correction\": 0.0,\n  \"rationales\": {\n    \"reason_quality\": \"...\",\n    \"memory_correction\": \"...\"\n  }\n}\n\nScoring rules — be strict, 1.0 is rare and reserved for exceptional work:\n- Use a 0.0 to 1.0 scale in 0.25 increments.\n\n- `reason_quality`: Are the reasons for each source reliability verdict grounded in SPECIFIC corpus content? Each reason must reference concrete details from the source (quotes, formulas, specific claims) — not just generic descriptions like \"this source is reliable because it's well-written.\"\n  - 1.0: Every reason cites specific content from the source it evaluates (exact claims, formulas, or quoted phrases). No generic filler.\n  - 0.75: Most reasons cite specific content but 1-2 fall back to generic descriptions.\n  - 0.5: Mix of specific and generic reasoning. Some reasons say things like \"this source is careful\" without citing what makes it careful.\n  - 0.25: Mostly generic labels (\"reliable\", \"misleading\") without evidence from the actual source text.\n  - 0.0: No meaningful per-source reasoning.\n\n- `memory_correction`: Did the durable workspace notes correct ALL FOUR prior mistaken beliefs? Check each one independently:\n  1. \"beam-search-style speedup trick\" → must explicitly clarify it preserves exact distribution via verification\n  2. \"high acceptance is enough to guarantee a win\" → must explain why acceptance alone is insufficient (draft cost, verification overhead)\n  3. \"unsure whether newer variants still need a separate draft model\" → must explain self-speculative approaches\n  4. \"mixing careful sources with loud secondary takes\" → must demonstrate clear source separation, not just list names\n  Score by counting how many of the 4 beliefs are properly corrected:\n  - 1.0: All 4 corrected with specific explanations grounded in corpus evidence\n  - 0.75: 3 of 4 corrected well\n  - 0.5: 2 of 4 corrected well\n  - 0.25: 1 of 4 corrected well\n  - 0.0: No meaningful corrections\n  Focus on durable workspace artifacts, not just `output/result.json`.\n"

/**
 * Upstream's llm_judge.py: the deterministic scores, the judge's two, the
 * rubric's weighted sum. A judge that fails zeroes its two and says so.
 */
export async function grader(c: Context): Promise<Grade> {
  const key = loadJson(c, '/tests/answer_key.json')
  const rubric = loadJson(c, '/tests/rubric.json')
  const result = loadJson(c, `${OUT}/result.json`)
  const aliases = discoverSourceAliases(c, sourceIdPatterns('space'))
  const structural = { ...structuralScores(c, result), ...sourceScores(result, key, aliases) }
  const prompt = pkbPrompt(c, key, result, structural, {
    beliefs: ['# Prior Memory Beliefs To Correct', 'memory_seed_beliefs'],
    expectations: 'memory_correction_expectations',
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
    source_partition_accuracy: structural.source_partition_accuracy,
    workspace_update: structural.workspace_update,
    reason_quality: verdict(payload, 'reason_quality'),
    memory_correction: verdict(payload, 'memory_correction'),
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
