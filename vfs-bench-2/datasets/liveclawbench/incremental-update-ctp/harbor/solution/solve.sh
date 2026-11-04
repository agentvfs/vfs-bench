#!/usr/bin/env bash
# Ours (vfs-bench-2): upstream's solution runs `openclaw agent`, a model, so
# there is no script of upstream's to port. This writes what to preserve,
# update and remove, each with the sources that decide it, and rewrites
# MEMORY.md as that delta.
set -euo pipefail
ROOT=/home/node/.openclaw
mkdir -p "$ROOT/output" "$ROOT/workspace/memory"

cat > "$ROOT/workspace/MEMORY.md" <<'EOF'
# Memory

## Speculative decoding, after the delta review

### Preserved
- **Exact distribution.** Speculative decoding keeps the target distribution exact: rejection sampling accepts a draft token with probability min(1, p/q), so the output is identical to standard autoregressive decoding (source_01_baseline; source_03_video: "the output distribution is identical"). Every variant keeps it.
- **Draft, then verify.** A drafter proposes K tokens and the target model verifies them in one parallel forward pass; that skeleton "has survived every iteration" (source_03_video, source_04_prior_note).
- **Not beam search.** It samples the target distribution exactly rather than searching for a high-scoring sequence (source_01_baseline).

### Updated
- **Separate draft model: not always.** Self-speculative methods draft with the target model itself: layer skipping (SWIFT, LayerSkip), Medusa's auxiliary heads, EAGLE's head on the hidden states (source_02_update, source_03_video). A separate draft model is one option, not a requirement.
- **Acceptance and speedup: necessary, not sufficient.** Wall-clock speedup depends on acceptance rate, draft cost and system fit together; 80% acceptance does not by itself mean a 3x speedup (source_02_update, source_03_video).

### Removed
- **"Cache warmup shortcut."** The cache-only framing is wrong: cache reuse is an implementation detail, not the algorithm, which is draft-then-verify with exact rejection sampling (source_01_baseline "Not Beam Search, Not Cache Reuse"; source_03_video says the framing "should be retired").
EOF

cat > "$ROOT/output/result.json" <<'EOF'
{
  "preserved": {
    "exact_distribution": "Kept: the target distribution stays exact. Rejection sampling accepts a draft token with probability min(1, p(x)/q(x)), so the output is identical to standard decoding (source_01_baseline; source_03_video: every variant preserves it).",
    "draft_verify": "Kept: the draft-then-verify loop. A drafter proposes K tokens and the target model verifies them in one parallel forward pass (source_01_baseline, source_04_prior_note); source_03_video calls it the skeleton that survived every iteration.",
    "not_beam_search": "Kept: it samples the target distribution exactly rather than searching for a high-scoring sequence (source_01_baseline)."
  },
  "updated": {
    "separate_draft_model": "Was: it always requires a separate draft model. Now: not always. Self-speculative methods (layer skip as in SWIFT and LayerSkip, Medusa's auxiliary heads, EAGLE) draft with the same model (source_02_update, source_03_video).",
    "acceptance_speedup": "Was: high acceptance implies speedup. Now: acceptance is necessary but not sufficient; wall-clock speedup also depends on draft cost and system fit (source_02_update, source_03_video)."
  },
  "removed": {
    "cache_shortcut": "Dropped: the 'cache warmup shortcut' framing confuses an implementation detail (cache reuse) with the algorithm (source_01_baseline 'Not Beam Search, Not Cache Reuse'; source_03_video says it should be retired)."
  },
  "evidence_source_ids": [
    "source_01_baseline",
    "source_02_update",
    "source_03_video",
    "source_04_prior_note"
  ],
  "updated_artifacts": [
    "MEMORY.md"
  ]
}
EOF
echo "Oracle: wrote $ROOT/output/result.json and $ROOT/workspace/MEMORY.md"
