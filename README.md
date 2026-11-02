<h1 align="center">
  <a href="https://agentvfs.org/benchmark/vfs-bench-1">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/vfs-bench-header-dark.png">
      <img src="assets/vfs-bench-header-light.png" width="100%" alt="VFS-Bench: One Task, Two Interfaces: MCP vs. a Virtual Filesystem" />
    </picture>
  </a>
</h1>

<p align="center">
    <a href="https://agentvfs.org" alt="Website">
        <img src="https://img.shields.io/badge/website-agentvfs.org-0C0C0C?labelColor=F0ECE2" /></a>
    <a href="https://agentvfs.org/benchmark/vfs-bench-1/leaderboard" alt="Leaderboard">
        <img src="https://img.shields.io/badge/vfs--bench_1.0-leaderboard-0C0C0C?labelColor=F0ECE2" /></a>
    <a href="https://agentvfs.org/blogs/agentvfs-1" alt="Blog">
        <img src="https://img.shields.io/badge/blog-AgentVFS-0C0C0C?labelColor=F0ECE2" /></a>
    <a href="https://agentvfs.org/vfs" alt="VFS.md">
        <img src="https://img.shields.io/badge/spec-VFS.md-0C0C0C?labelColor=F0ECE2" /></a>
    <br/>
    <a href="https://github.com/strukto-ai/mirage" alt="Built on Mirage">
        <img src="https://img.shields.io/badge/built_on-Mirage-0C0C0C?labelColor=F0ECE2" /></a>
    <a href="https://github.com/agentvfs/vfs-bench/blob/main/LICENSE" alt="License">
        <img src="https://img.shields.io/badge/license-MIT-0C0C0C?labelColor=F0ECE2" /></a>
    <a href="https://discord.gg/u8BPQ65KsS" alt="Discord">
        <img src="https://img.shields.io/badge/discord-join-0C0C0C?labelColor=F0ECE2&logo=discord&logoColor=0C0C0C" /></a>
</p>

VFS-Bench is **one task, two interfaces**. Every task runs twice: once
through the task's MCP servers, as in the original benchmark, and once
through [AgentVFS](https://agentvfs.org), a virtual filesystem with
[VFS.md](https://agentvfs.org/vfs), where the agent reaches the same
services with shell commands. Each task keeps its original instruction, data
and evaluator, so the two runs differ only in the interface, and the
benchmark measures how often the agent succeeds and how many tokens each
interface costs. VFS-Bench 2.0, in progress, runs recent, hard agent
benchmarks through AgentVFS alone.

VFS-Bench 1.0 has **200 tasks**, 100 from
[MCP-Atlas](https://arxiv.org/abs/2602.00933) and 100 from
[Toolathlon](https://arxiv.org/abs/2510.25726), over 46 external services
such as email, Canvas, Google Drive and Sheets, GitHub, Notion and Slack.
With a virtual filesystem, agents use **52% fewer tokens** on average than
with MCP tool calling, and pass@1 rises from **77.6% to 81.6%**.

| | [VFS-Bench 1.0](vfs-bench-1/README.md) | [VFS-Bench 2.0](vfs-bench-2/README.md) (in progress) |
|---|---|---|
| Interfaces | MCP and AgentVFS, side by side | AgentVFS only |
| Tasks | 200, from MCP-Atlas and Toolathlon | Recent, hard benchmarks: Gaia2, Claw-Eval, AutomationBench and more |
| Services | Local fakes in Docker | Local mock servers, a run of each per trial |
| Runs on | Its own harness (`agent/run_agent.py`) | [Harbor](https://pypi.org/project/harbor/), on Mirage |
| Folder | [`vfs-bench-1/`](vfs-bench-1/) | [`vfs-bench-2/`](vfs-bench-2/) |

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/agentvfs-overview-dark.png">
    <img src="assets/agentvfs-overview-light.png" alt="AgentVFS overview: an agent's shell commands pass through policies to a virtual filesystem, VFS.md and virtual CLIs, which reach external services such as email, Google Drive, Canvas, Slack, GitHub and Notion" width="100%">
  </picture>
</p>

Here is what the agent is given in the VFS arm of a Toolathlon task over
Google Drive, abridged. It replaces the MCP server's tool schemas:

````markdown
---
name: workspace-filesystem
description: The virtual filesystem layout of this workspace.
---

# Virtual Filesystem

Google Drive is virtualized at `/gd`. Read it with shell commands; spreadsheet
operations are listed in SKILL.md.

| Path | Description |
|---|---|
| `/gd` | Google Drive, read-only. Directories are Drive folders; change spreadsheets with the `google-sheet` CLI. |
````

and the agent works on the data with the tools it already knows. These are
commands from recorded runs of the task:

```bash
find /gd -name '*.gsheet.json'
f="/gd/NHL-B2B-Analysis/NHL 2425 Schedule.gsheet.json"
jq -r '.sheets[0].data[0].rowData[1:][] | [.values[].formattedValue] | @tsv' "$f" > s.tsv
cut -f4 s.tsv | sort | uniq -c
google-sheet create-spreadsheet '{"title":"NHL-B2B-Analysis"}'
google-sheet update-cells "$(jq -c '{spreadsheet_id:"f0003",sheet:"Sheet1",range:"A1:F33",data:.}' out.json)"
```

## About

- **Unified interface.** One virtual filesystem presents every service as
  files and commands, and agents read them live without copying anything
  locally.
- **Performance.** Agents filter and chain data with Unix-like tools and
  scripts, saving more than half of MCP's tokens on average with better
  accuracy.
- **Policy and security.** The filesystem is purely virtual, so a policy
  checks every command and decides what agents may read, change or run,
  keeping secrets and tests out of reach.
- **Same task, same data, same grader.** Both arms get the byte-identical
  task text, the same seeded fixtures and the original, unmodified evaluator;
  services run as local fakes that reproduce their APIs, reset and reseeded
  before every run, so the benchmark reruns without live accounts.
- **Same operations.** The VFS arm's virtual CLIs offer the MCP servers'
  operations with the same arguments, so both interfaces reach the same
  actions. Every divergence from upstream is declared in one file.

AgentVFS has four parts, and VFS-Bench measures them together against MCP:

1. **Virtual Filesystem.** Each service's data appears as files in the shape
   of its API resources, read with `ls`, `grep`, `cat` and `jq`.
2. **VFS.md.** A short Markdown file describes the layout and the file
   formats, so the agent finds the data without trial and error.
3. **Virtual CLIs.** Actions with side effects run as CLIs that SKILL.md
   describes, so every change to a service is an explicit command.
4. **Policy.** Every read, write and command passes through a policy before
   it runs.

## Results

VFS-Bench 1.0: pass@1 and mean total tokens per task (input plus output, over every
request) of each model's first trial, MCP against VFS. The advanced tier runs
at medium reasoning effort and the efficient tier at maximum. The full
leaderboard, every task and every trajectory are on
[agentvfs.org](https://agentvfs.org/benchmark/vfs-bench-1/leaderboard).

| Dataset | Model | MCP pass@1 | VFS pass@1 | MCP tokens | VFS tokens | Token reduction |
| --- | --- | --: | --: | --: | --: | --: |
| MCP-Atlas | Claude Opus 5.5 | 93% | **96%** | 311,129 | **37,744** | **88%** |
| MCP-Atlas | GPT-6.1 Sol | 88% | **90%** | 77,708 | **37,137** | **52%** |
| MCP-Atlas | GPT-5.6 Luna | 81% | **87%** | 205,587 | **106,960** | **48%** |
| MCP-Atlas | Claude Haiku 5.5 | 84% | **89%** | 374,015 | **207,805** | **44%** |
| MCP-Atlas | Gemini 3.8 Flash | 91% | **94%** | 1,343,771 | **745,790** | **45%** |
| Toolathlon | Claude Opus 5.5 | 83% | **86%** | 616,684 | **166,218** | **73%** |
| Toolathlon | GPT-6.1 Sol | 75% | **75%** | 683,010 | **193,372** | **72%** |
| Toolathlon | GPT-5.6 Luna | 61% | **73%** | 3,913,601 | **1,558,475** | **60%** |
| Toolathlon | Claude Haiku 5.5 | 70% | **74%** | 2,823,610 | **2,543,913** | **10%** |
| Toolathlon | Gemini 3.8 Flash | 50% | **52%** | 6,719,002 | **5,070,925** | **25%** |

## Datasets

### VFS-Bench 1.0

Tasks are selected from benchmarks of realistic, multi-step tasks over real
MCP servers, preferring tasks that read or change data in several external
services. Each dataset keeps its own agent harness, with its loop, request
limit and context handling, for both arms.

|                   | [MCP-Atlas](vfs-bench-1/task/mcpatlas/README.md) | [Toolathlon](vfs-bench-1/task/toolathlon/README.md) | Total |
| ----------------- | --: | --: | --: |
| Tasks             | 100 | 100 | 200 |
| External services | 24  | 29  | 46  |
| Services as VFS   | 5   | 9   | 13  |
| Virtual CLIs      | 26  | 28  | 51  |

Every service a task reaches, through MCP in one arm and through the virtual
filesystem and its CLIs in the other:

|  | Services |
| --- | --- |
| **Files and Documents** | <img src="assets/icons/local-files.svg" width="20" height="20" alt="Local files" title="Local files" />  <img src="assets/icons/google-drive.svg" width="20" height="20" alt="Google Drive" title="Google Drive" />  <img src="assets/icons/google-sheets.svg" width="20" height="20" alt="Google Sheets" title="Google Sheets" />  <img src="assets/icons/excel.svg" width="20" height="20" alt="Excel" title="Excel" />  <img src="assets/icons/word.svg" width="20" height="20" alt="Word" title="Word" />  <img src="assets/icons/powerpoint.svg" width="20" height="20" alt="PowerPoint" title="PowerPoint" />  <img src="assets/icons/pdf.svg" width="20" height="20" alt="PDF" title="PDF" /> |
| **Messaging and Work** | <img src="assets/icons/email.svg" width="20" height="20" alt="Email" title="Email" />  <img src="assets/icons/google-workspace.svg" width="20" height="20" alt="Google Workspace" title="Google Workspace" />  <img src="assets/icons/slack.svg" width="20" height="20" alt="Slack" title="Slack" />  <img src="assets/icons/notion.svg" width="20" height="20" alt="Notion" title="Notion" />  <img src="assets/icons/airtable.svg" width="20" height="20" alt="Airtable" title="Airtable" />  <img src="assets/icons/google-calendar.svg" width="20" height="20" alt="Google Calendar" title="Google Calendar" />  <img src="assets/icons/google-forms.svg" width="20" height="20" alt="Google Forms" title="Google Forms" />  <img src="assets/icons/canvas.svg" width="20" height="20" alt="Canvas" title="Canvas" /> |
| **Code and ML** | <img src="assets/icons/github.svg" width="20" height="20" alt="GitHub" title="GitHub" />  <img src="assets/icons/git.svg" width="20" height="20" alt="Git" title="Git" />  <img src="assets/icons/hugging-face.svg" width="20" height="20" alt="Hugging Face" title="Hugging Face" />  <img src="assets/icons/weights-biases.svg" width="20" height="20" alt="Weights & Biases" title="Weights & Biases" />  <img src="assets/icons/kubernetes.svg" width="20" height="20" alt="Kubernetes" title="Kubernetes" />  <img src="assets/icons/context7.svg" width="20" height="20" alt="Context7" title="Context7" /> |
| **Databases and Cloud** | <img src="assets/icons/mongodb.svg" width="20" height="20" alt="MongoDB" title="MongoDB" />  <img src="assets/icons/snowflake.svg" width="20" height="20" alt="Snowflake" title="Snowflake" />  <img src="assets/icons/google-cloud.svg" width="20" height="20" alt="Google Cloud" title="Google Cloud" />  <img src="assets/icons/memory.svg" width="20" height="20" alt="Memory" title="Memory" /> |
| **Search and Research** | <img src="assets/icons/web.svg" width="20" height="20" alt="Web" title="Web" />  <img src="assets/icons/browser.svg" width="20" height="20" alt="Browser" title="Browser" />  <img src="assets/icons/exa.svg" width="20" height="20" alt="Exa" title="Exa" />  <img src="assets/icons/oxylabs.svg" width="20" height="20" alt="Oxylabs" title="Oxylabs" />  <img src="assets/icons/arxiv.svg" width="20" height="20" alt="arXiv" title="arXiv" />  <img src="assets/icons/wikipedia.svg" width="20" height="20" alt="Wikipedia" title="Wikipedia" />  <img src="assets/icons/pubmed.svg" width="20" height="20" alt="PubMed" title="PubMed" />  <img src="assets/icons/google-scholar.svg" width="20" height="20" alt="Google Scholar" title="Google Scholar" />  <img src="assets/icons/duckduckgo.svg" width="20" height="20" alt="DuckDuckGo" title="DuckDuckGo" />  <img src="assets/icons/open-library.svg" width="20" height="20" alt="Open Library" title="Open Library" />  <img src="assets/icons/clinicaltrials-gov.svg" width="20" height="20" alt="ClinicalTrials.gov" title="ClinicalTrials.gov" />  <img src="assets/icons/met-museum.svg" width="20" height="20" alt="Met Museum" title="Met Museum" /> |
| **Commerce, Finance and Travel** | <img src="assets/icons/woocommerce.svg" width="20" height="20" alt="WooCommerce" title="WooCommerce" />  <img src="assets/icons/yahoo-finance.svg" width="20" height="20" alt="Yahoo Finance" title="Yahoo Finance" />  <img src="assets/icons/google-maps.svg" width="20" height="20" alt="Google Maps" title="Google Maps" />  <img src="assets/icons/openstreetmap.svg" width="20" height="20" alt="OpenStreetMap" title="OpenStreetMap" />  <img src="assets/icons/weather.svg" width="20" height="20" alt="Weather" title="Weather" />  <img src="assets/icons/national-parks.svg" width="20" height="20" alt="National Parks" title="National Parks" />  <img src="assets/icons/12306.svg" width="20" height="20" alt="12306" title="12306" />  <img src="assets/icons/whois.svg" width="20" height="20" alt="WHOIS" title="WHOIS" />  <img src="assets/icons/youtube.svg" width="20" height="20" alt="YouTube" title="YouTube" />  <img src="assets/icons/howtocook.svg" width="20" height="20" alt="HowToCook" title="HowToCook" /> |

Many services run as local fakes that reproduce their APIs (Google
Workspace, Notion, GitHub, Slack, Airtable, mail, Canvas, WooCommerce,
Kubernetes, BigQuery and Cloud Storage, Snowflake, W&B), so a run needs no
live account and every run starts from the same seeded state.

### VFS-Bench 2.0

| Dataset | Tasks | Dataset | Tasks |
|---|--:|---|--:|
| [Gaia2](vfs-bench-2/datasets/gaia2/README.md) | 460 | [ComplexMCP](vfs-bench-2/datasets/complexmcp/README.md) | 47 |
| [AutomationBench](vfs-bench-2/datasets/automationbench/README.md) | 600 | [DataSpace](vfs-bench-2/datasets/dataspace/README.md) | 46 |
| [Claw-Eval](vfs-bench-2/datasets/claweval/README.md) | 126 | [EnterpriseOps-Gym](vfs-bench-2/datasets/enterpriseops/README.md) | 103 |
| [LiveClawBench](vfs-bench-2/datasets/liveclawbench/README.md) | 70 | | |

## Get Started

- **VFS-Bench 1.0**: install, run one task through both arms, and how it
  works: [vfs-bench-1/README.md](vfs-bench-1/README.md).
- **VFS-Bench 2.0**: set up Mirage and Harbor, download a dataset, and run
  its tasks: [vfs-bench-2/README.md](vfs-bench-2/README.md).
- **The UI**: a page to start VFS-Bench 2.0's Harbor runs and watch them:
  [ui/README.md](ui/README.md).

For example, VFS-Bench 2.0's Gaia2, every task at once on one Mirage
daemon, from `vfs-bench-2/`:

```bash
uv run --project formats/harbor harbor run -y -c datasets/gaia2/harbor/job.yaml \
  -a oracle -n 256 --ek workers=8
```

## Repository

```
vfs-bench-1/   VFS-Bench 1.0: MCP against AgentVFS, its harness and fakes
vfs-bench-2/   VFS-Bench 2.0: AgentVFS on Harbor and Mirage
ui/            a page to run VFS-Bench 2.0 and watch it
assets/        this page's images
```

## Contributing

VFS-Bench is developed in the open. To contribute a dataset or a Mirage
backend to VFS-Bench 2.0, see
[agentvfs.org/contribution](https://agentvfs.org/contribution), or join the
[Discord](https://discord.gg/u8BPQ65KsS).

## Citation

If you find AgentVFS or VFS-Bench useful in your work, please cite it as
follows.

```bibtex
@misc{zhang2026agentvfs,
  title  = {AgentVFS: A Virtual Filesystem Interface for AI Agents},
  author = {Zhang, Zecheng and Li, Guohao and Xiao, Yuxin and He, Yuan and
            Shen, Qijia and Lai, Douglas and Qi, Zhenting and Bevilacqua, Alex and
            Huang, Xingyue and Song, Bowen and Xu, Yue and Zheng, Han and
            Qi, Fangfang and Li, Li and Nkemdilim, Tochukwu and
            Akinyemi, Stephen and Qu, Ao and Cidon, Asaf and You, Jiaxuan and
            Ying, Rex and Luan, Xiaofan and Tang, Siddon},
  year   = {2026},
  month  = oct,
  url    = {https://agentvfs.org/blogs/agentvfs-1}
}
```
