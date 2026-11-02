<h1 align="center">
  <a href="https://agentvfs.org/benchmark/vfs-bench-1">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/vfs-bench-header-dark.png">
      <img src="assets/vfs-bench-header-light.png" width="100%" alt="VFS-Bench" />
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

VFS-Bench measures agents that work through
[AgentVFS](https://agentvfs.org), a virtual filesystem with
[VFS.md](https://agentvfs.org/vfs): the agent reaches every service with
shell commands over files, and with CLIs for actions. Each task keeps its
original instruction, data and grader.

VFS-Bench 1.0 compared AgentVFS with MCP on 200 tasks from MCP-Atlas and
Toolathlon; its tasks, results and trajectories are at
[agentvfs.org/benchmark/vfs-bench-1](https://agentvfs.org/benchmark/vfs-bench-1).
VFS-Bench 2.0, in progress, runs recent, hard agent benchmarks through
AgentVFS alone.

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

## Services

The agent reaches every service through the virtual filesystem and its
CLIs:

|  | Services |
| --- | --- |
| **Files and Documents** | <img src="assets/icons/local-files.svg" width="20" height="20" alt="Local files" title="Local files" />  <img src="assets/icons/google-drive.svg" width="20" height="20" alt="Google Drive" title="Google Drive" />  <img src="assets/icons/google-sheets.svg" width="20" height="20" alt="Google Sheets" title="Google Sheets" />  <img src="assets/icons/excel.svg" width="20" height="20" alt="Excel" title="Excel" />  <img src="assets/icons/word.svg" width="20" height="20" alt="Word" title="Word" />  <img src="assets/icons/powerpoint.svg" width="20" height="20" alt="PowerPoint" title="PowerPoint" />  <img src="assets/icons/pdf.svg" width="20" height="20" alt="PDF" title="PDF" /> |
| **Messaging and Work** | <img src="assets/icons/email.svg" width="20" height="20" alt="Email" title="Email" />  <img src="assets/icons/google-workspace.svg" width="20" height="20" alt="Google Workspace" title="Google Workspace" />  <img src="assets/icons/slack.svg" width="20" height="20" alt="Slack" title="Slack" />  <img src="assets/icons/notion.svg" width="20" height="20" alt="Notion" title="Notion" />  <img src="assets/icons/airtable.svg" width="20" height="20" alt="Airtable" title="Airtable" />  <img src="assets/icons/google-calendar.svg" width="20" height="20" alt="Google Calendar" title="Google Calendar" />  <img src="assets/icons/google-forms.svg" width="20" height="20" alt="Google Forms" title="Google Forms" />  <img src="assets/icons/canvas.svg" width="20" height="20" alt="Canvas" title="Canvas" /> |
| **Code and ML** | <img src="assets/icons/github.svg" width="20" height="20" alt="GitHub" title="GitHub" />  <img src="assets/icons/git.svg" width="20" height="20" alt="Git" title="Git" />  <img src="assets/icons/hugging-face.svg" width="20" height="20" alt="Hugging Face" title="Hugging Face" />  <img src="assets/icons/weights-biases.svg" width="20" height="20" alt="Weights & Biases" title="Weights & Biases" />  <img src="assets/icons/kubernetes.svg" width="20" height="20" alt="Kubernetes" title="Kubernetes" />  <img src="assets/icons/context7.svg" width="20" height="20" alt="Context7" title="Context7" /> |
| **Databases and Cloud** | <img src="assets/icons/mongodb.svg" width="20" height="20" alt="MongoDB" title="MongoDB" />  <img src="assets/icons/snowflake.svg" width="20" height="20" alt="Snowflake" title="Snowflake" />  <img src="assets/icons/google-cloud.svg" width="20" height="20" alt="Google Cloud" title="Google Cloud" />  <img src="assets/icons/memory.svg" width="20" height="20" alt="Memory" title="Memory" /> |
| **Search and Research** | <img src="assets/icons/web.svg" width="20" height="20" alt="Web" title="Web" />  <img src="assets/icons/browser.svg" width="20" height="20" alt="Browser" title="Browser" />  <img src="assets/icons/exa.svg" width="20" height="20" alt="Exa" title="Exa" />  <img src="assets/icons/oxylabs.svg" width="20" height="20" alt="Oxylabs" title="Oxylabs" />  <img src="assets/icons/arxiv.svg" width="20" height="20" alt="arXiv" title="arXiv" />  <img src="assets/icons/wikipedia.svg" width="20" height="20" alt="Wikipedia" title="Wikipedia" />  <img src="assets/icons/pubmed.svg" width="20" height="20" alt="PubMed" title="PubMed" />  <img src="assets/icons/google-scholar.svg" width="20" height="20" alt="Google Scholar" title="Google Scholar" />  <img src="assets/icons/duckduckgo.svg" width="20" height="20" alt="DuckDuckGo" title="DuckDuckGo" />  <img src="assets/icons/open-library.svg" width="20" height="20" alt="Open Library" title="Open Library" />  <img src="assets/icons/clinicaltrials-gov.svg" width="20" height="20" alt="ClinicalTrials.gov" title="ClinicalTrials.gov" />  <img src="assets/icons/met-museum.svg" width="20" height="20" alt="Met Museum" title="Met Museum" /> |
| **Commerce, Finance and Travel** | <img src="assets/icons/woocommerce.svg" width="20" height="20" alt="WooCommerce" title="WooCommerce" />  <img src="assets/icons/yahoo-finance.svg" width="20" height="20" alt="Yahoo Finance" title="Yahoo Finance" />  <img src="assets/icons/google-maps.svg" width="20" height="20" alt="Google Maps" title="Google Maps" />  <img src="assets/icons/openstreetmap.svg" width="20" height="20" alt="OpenStreetMap" title="OpenStreetMap" />  <img src="assets/icons/weather.svg" width="20" height="20" alt="Weather" title="Weather" />  <img src="assets/icons/national-parks.svg" width="20" height="20" alt="National Parks" title="National Parks" />  <img src="assets/icons/12306.svg" width="20" height="20" alt="12306" title="12306" />  <img src="assets/icons/whois.svg" width="20" height="20" alt="WHOIS" title="WHOIS" />  <img src="assets/icons/youtube.svg" width="20" height="20" alt="YouTube" title="YouTube" />  <img src="assets/icons/howtocook.svg" width="20" height="20" alt="HowToCook" title="HowToCook" /> |

Services run as local fakes that reproduce their APIs, so a run needs no
live account and every run starts from the same seeded state.

## Repository

- [VFS-Bench 1.0](vfs-bench-1/README.md)
- [VFS-Bench 2.0](vfs-bench-2/README.md)
- [UI](ui/README.md) (Beta)

## Contributing

VFS-Bench is developed in the open. VFS-Bench 2.0 is where new work goes:
[`vfs-bench-2/`](vfs-bench-2/README.md) shows how a dataset is laid out and
run. To contribute a dataset or a Mirage backend, see
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
