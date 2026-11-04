import { PyFloat } from '../../../workspace/py.ts'
import { type Context, type Grade, GWS, eq, lower, orderBy } from '../../../workspace/grader.ts'
import { anchorScores, briefGrade, listOf, structurallyValid } from '../graders/brief.ts'

// Upstream's tests/llm_judge.py, its judge's instructions verbatim.
const SYSTEM_PROMPT = "You are a strict evaluator for a vendor due diligence brief benchmark case. Be critical — most work has significant gaps.\n\nScore only the semantic quality of the agent's due diligence brief. Do not reward length, formatting, or generic statements.\nEvery red flag must be traceable to a specific corpus document or email detail. Generic risk boilerplate (\"vendor lock-in\", \"security risks\") with no corpus linkage must receive low scores.\n\nReturn JSON only with this shape:\n{\n  \"evidence_grounding\": 0.0,\n  \"recommendation_quality\": 0.0,\n  \"vendor_background_quality\": 0.0,\n  \"rationales\": {\n    \"evidence_grounding\": \"...\",\n    \"recommendation_quality\": \"...\",\n    \"vendor_background_quality\": \"...\"\n  }\n}\n\nScoring rules — be strict, 1.0 is rare:\n- Use a 0.0 to 1.0 scale in 0.25 increments.\n\n- `evidence_grounding`: Are the red flags each backed by a specific, citable detail from the email or corpus materials? Generic claims like \"the vendor may have security issues\" or \"pricing could be high\" with no reference to a specific document fact are not evidence-grounded.\n  - 1.0: Every red flag cites a specific fact (e.g., \"SOC 2 Type II not yet certified per security questionnaire\", \"IP dispute with ForgeNet per internal memo\"). No fabricated or ungrounded claims.\n  - 0.75: Most red flags are grounded; 1 is generic or paraphrased without traceable source.\n  - 0.5: Half grounded, half generic boilerplate.\n  - 0.25: Mostly generic risks with minimal corpus linkage.\n  - 0.0: All red flags are invented or could apply to any vendor without reading the materials.\n\n- `recommendation_quality`: Is the recommendation actionable and proportionate to the identified risks? A good recommendation names a specific next step or condition (e.g., \"proceed only after receiving SOC 2 Type II report and resolution of the ForgeNet IP dispute\"). A bad recommendation is vague (\"proceed with caution\") or fails to address the most critical risks.\n  - 1.0: Recommendation explicitly addresses the top risks with named conditions. Clearly states proceed / conditional / do not proceed with a rationale grounded in the evidence.\n  - 0.75: Mostly actionable but missing one specific condition or risk reference.\n  - 0.5: Generic recommendation that doesn't engage with the specific risks identified.\n  - 0.25: Contradicts the evidence or ignores critical red flags.\n  - 0.0: No meaningful recommendation or completely ungrounded.\n\n- `vendor_background_quality`: Does vendor_background correctly identify the vendor using details from the intro email and corpus, and does fit_assessment meaningfully engage with the technical need? vendor_background must include the contact name (Marcus Webb) and email address (partnerships@cloudedge.io) from the intro email, plus key corpus facts (DataGuard / AES-256-GCM, Series A / $18M, founded 2022). fit_assessment should address whether the product actually fits the stated use case — not generic statements.\n  - 1.0: Contact name and email correct from email; company facts (product, funding, founding year) from corpus; fit_assessment engages specifically with the technical use case.\n  - 0.75: Contact name correct but email missing, OR one corpus fact missing; fit_assessment adequate.\n  - 0.5: Company and product identified from corpus but contact info missing or wrong; fit_assessment generic.\n  - 0.25: Only company name correct; background mostly fabricated; fit_assessment absent or vague.\n  - 0.0: Wrong vendor, fabricated contact info, or background entirely missing.\n"

/**
 * `fetch_email_context`: the vendor's introduction, the newest inbox email
 * naming CloudEdge or a vendor, as upstream's email app lists the inbox
 * (`ORDER BY created_at DESC`), here from the gws run. Its sender is the
 * From header's name and address, as the email app's `sender_name` and
 * `sender_email` are.
 */
function emailContext(c: Context): string {
  const labels = c.rows(GWS, 'MessageLabel')
  const headers = c.rows(GWS, 'MessageHeader')
  const inbox = c
    .rows(GWS, 'Message')
    .filter((m) => {
      const own = labels.filter((l) => eq(l.tenant, m.tenant) && eq(l.messageId, m.id)).map((l) => l.labelId)
      return own.includes('INBOX') && !own.includes('TRASH')
    })
    .sort(orderBy(['internalDate', -1], ['seq', -1]))
  for (const m of inbox) {
    const own = headers.filter((h) => eq(h.tenant, m.tenant) && eq(h.messageId, m.id)).sort(orderBy(['seq', 1]))
    const header = (name: string) => own.find((h) => lower(h.name) === name)?.value ?? ''
    const subject = header('subject'),
      body = m.bodyText ?? ''
    if (!(lower(subject).includes('cloudedge') || lower(subject).includes('vendor') || lower(body).includes('cloudedge'))) continue
    const from = /^\s*(?:"((?:[^"\\]|\\.)*)"|([^<]*?))\s*<([^<>]*)>\s*$/.exec(header('from'))
    const name = from ? (from[1] ?? from[2] ?? '').replace(/\\(.)/g, '$1') : '',
      address = from ? from[3]! : header('from')
    return `Subject: ${subject}\nFrom: ${name} <${address}>\nBody:\n${body}`
  }
  throw new Error('Vendor intro email not found in inbox — cannot judge email-backed evidence')
}

/** Upstream's llm_judge.py: its deterministic_checks.py's three scores, the judge's three. */
export function grader(c: Context): Promise<Grade> {
  return briefGrade(
    c,
    SYSTEM_PROMPT,
    (result, key) => ({
      structural_valid: structurallyValid(result, key),
      red_flags_minimum: new PyFloat(listOf(result, 'red_flags', key.get('min_red_flags') ?? 3) ? 1 : 0),
      ...anchorScores(result, key),
    }),
    ['# Vendor Introduction Email', emailContext(c)],
    ['vendor_background_quality', 'evidence_grounding', 'recommendation_quality']
  )
}
