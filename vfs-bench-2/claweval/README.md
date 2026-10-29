# Claw-Eval

[claw-eval/claw-eval](https://github.com/claw-eval/claw-eval) @ `5680b8b`,
MIT. Its general split has 161 personal-assistant tasks over 13 mock
services (gmail, calendar, contacts, crm, helpdesk, finance, ...). Each
task's own grader scores the run, and asks an LLM judge for part of the
score.

This port takes the 126 general tasks whose agent works through mock
services: the 60 that use services only, and 66 of the 68 that also give the
agent files (`sandbox_files`), which are mounted at `/workspace`. 52 of them
are in Chinese. The rest of the split is left for later or out:
- T097 and T098 give the agent PDFs that upstream's repo does not have;
- 25 browse the live web (`web_real`);
- 8 have no services and run only in upstream's sandbox container.

The multi_turn split is out: an LLM plays the user there.

## Setup

```sh
python3 -I claweval/setup.py
```

This clones upstream into `state/claweval/src`, checking out only
`mock_services/`, `tasks/` and `src/`. The services and the graders run in
this directory's uv project. The judge needs `OPENAI_API_KEY` and
`OPENAI_BASE_URL`, as the model does. `JUDGE_MODEL` picks its model, and
defaults to upstream's, `google/gemini-3-flash-preview`.

## How it maps

| Upstream | Here |
|---|---|
| The runner starts each service, `python mock_services/<service>/server.py`, with the task's fixtures in its environment | The same app, unchanged, on a free port (`serve.py`), with the same environment |
| One tool per service endpoint, `helpdesk_get_ticket` | A CLI per service with the tools as subcommands, `helpdesk get-ticket --ticket-id TK-1201`, generated from the task's tool schemas |
| The dispatcher POSTs a tool call's input to its endpoint and records the call | The CLI does the same and records the same dispatch |
| The runner writes each of the task's `sandbox_files` to `/workspace/<path>` in the sandbox container, which the agent can also write to | The same files, copied into the run directory and mounted writable at `/workspace` (`workspace.yaml`) |
| The system prompt gives the task's `mock_today` | The same line, ahead of Mirage's prompt |
| After the run, the runner fetches each service's audit log | The same logs, as the run's snapshot |
| `grader.py`, with the trace, the audit logs and the judge | The same grader, unchanged, given the run converted to upstream's trace (`grade.py`). A task passes at upstream's threshold, a task score of 0.75. |

## Divergences from upstream

- The agent calls the tools through CLIs, not as function calls.
- A call the CLI rejects, such as one missing a required flag, never reaches
  the service, so it is not a dispatch. Upstream sends any input the model
  gives, and the service's 422 counts against robustness.
- The judge is reached over the chat completions API, which any gateway
  serves, where upstream calls Gemini's own API. Its prompts are upstream's.
- When the judge gives up retrying, the grade fails with an error. Upstream
  would score that part 0, failing the agent for the judge's outage.
- The seed snapshot is the services' audit logs, which start empty, so
  `harness/determinism.ts` only shows that they do. The fixtures are files,
  and a task with `mock_today` keeps their dates as written. Without it,
  gmail and calendar shift their dates to the wall clock, as upstream's do.
- The workspace's `date` reads the wall clock. Upstream's sandbox does too.
- Upstream snapshots the sandbox's files after the run (`env_snapshot`), but
  no grader in scope reads them, so the run's `/workspace` is not graded.

## Tasks

Tasks with `sandbox_files` list them as files.

| Task | Upstream | Services |
|---|---|---|
| `incident-postmortem-zh` | `T037zh_incident_postmortem` | helpdesk, config, gmail, kb, notes, scheduler; files |
| `email-phishing-triage` | `T075_email_phishing_injection` | gmail; files |
| `army-expenditures` | `T085_officeqa_army_expenditures` | ocr (`ocr-t59`); files |
| `complaint-investigation` | `T110_complaint_investigation` | gmail, contacts, crm, finance |
| `project-progress-report-zh` | `T149zh_project_progress_report` | calendar, notes, todo, contacts |
| `supply-chain-investigation` | `T152_supply_chain_investigation` | finance, inventory, crm, helpdesk |
| `market-research-report` | `T154_market_research_report` | rss, kb, crm, gmail, contacts |
| `onsite-support-dispatch` | `T156_onsite_support_dispatch` | gmail, calendar, contacts, crm, helpdesk |
| `month-end-reconciliation` | `T158_month_end_reconciliation` | finance, crm, config, inventory, scheduler |
| `automation-failure-recovery-zh` | `T161zh_automation_failure_recovery` | scheduler, config, helpdesk, kb, inventory |
| `quarterly-customer-review-zh` | `T163zh_quarterly_customer_review` | gmail, contacts, finance, rss, crm |
