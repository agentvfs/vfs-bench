# AutomationBench

[zapier/AutomationBench](https://github.com/zapier/AutomationBench) v1.0.6
(`4a8e106`), MIT. There are 606 business-workflow tasks across 47 simulated
SaaS apps. Each is graded on the end state of its world.

## Setup

```sh
uv run --project automationbench python -I automationbench/setup.py
```

uv installs the pinned package from `pyproject.toml`. Setup writes each
ported task's row, as upstream's dataset loader builds it (noise included),
to `state/automationbench/tasks/<task_name>.json`.

## How it maps

| Upstream | Here |
|---|---|
| `AutomationBenchEnv` with `toolset="api"`, the default | Upstream's `WorldState`, tools and rubric, unchanged behind the bridge (`world.py`) |
| Tools `api_search`, `api_fetch`, `base64_encode` | The CLI `api search`, `api fetch` and `api base64-encode`, described as upstream describes them to a model |
| `setup_state`: the world from `initial_state`, gated by `compute_allowed_services` | `reset`, the same way |
| `update_tool_args`: drop `{}` arguments, pass the world | `call`, the same way |
| The system prompt, then the user message | The system prompt, then the CLIs' docs; the user message is the instruction |
| `partial_credit`; a task counts at 1.0 (`task_completed_correctly`) | The same. Each assertion is a check, and the run passes at 1.0. |

## Divergences from upstream

- Ids that upstream draws from `uuid4` or from `random` (HubSpot's,
  Zendesk's, Mailchimp's and others) come from generators seeded with the
  task's name. So two seeds give the same ids, in upstream's formats.
  Timestamps are not frozen: as upstream does, the world stamps what a task
  leaves undated from the wall clock, and most tasks set no
  `meta.current_time`, so it is the real time too. `index.ts` declares
  those fields (`clockFields`), and `harness/determinism.ts` lets only
  them differ between two seeds, by the time between the seeds.
- The apps are reached through the `api` CLI only. Nothing is mounted.
- The world never gets the model's OpenAI key. Given one, upstream's
  ChatGPT app calls OpenAI; without it, as here, the app gives upstream's
  own simulated reply.

## Tasks

| Task | Upstream | Apps |
|---|---|---|
| `competitive-displacement-outreach` | `sales.competitive_displacement_outreach` | gmail, google_sheets, linkedin, salesforce |
| `docusign-annual-review` | `operations.docusign_annual_review` | confluence, docusign, gmail, google_sheets, monday, slack, zoom |
| `event-registration-sync` | `marketing.event_registration_sync` | gmail, google_sheets, hubspot, mailchimp |
| `gorgias-refund-processing` | `support.gorgias_refund_processing` | gmail, google_sheets, gorgias, jira, slack |
| `helpcrunch-usage-alerts` | `support.helpcrunch_usage_alerts` | gmail, google_sheets, helpcrunch, salesforce |
| `hubspot-ticket-escalation` | `operations.hubspot_ticket_escalation` | gmail, google_sheets, hubspot, slack |
| `intern-program-coordination` | `hr.intern_program_coordination` | asana, gmail, google_drive, google_sheets, slack |
| `invoice-email-extract` | `finance.invoice_email_extract` | gmail, google_sheets, slack |
| `safety-certification-gap-analysis` | `operations.safety_certification_gap_analysis` | gmail, google_sheets, jira |
| `twilio-facilities-emergency` | `operations.twilio_facilities_emergency` | gmail, google_sheets, monday, notion, twilio |
| `zoho-freshdesk-escalation` | `support.zoho_freshdesk_escalation` | freshdesk, google_sheets, slack, zoho_desk |

Two tasks are left out because upstream's grader fails a faithful solution:

- `operations.salesforce_escalated_customer` wants `275` in a Slack post,
  but its number guard rejects `$275,000`, the ARR as the task's email gives
  it and the task asks to keep verbatim.
- `hr.multi_app_new_hire_setup` looks for the hire's name in a BambooHR
  field called `name`, which the API's employee create (`firstName`,
  `lastName`) never sets.
