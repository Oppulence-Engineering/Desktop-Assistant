<a href="https://www.youtube.com/watch?v=5AWoGo-L16I" target="_blank" rel="noopener noreferrer">
  <img width="1339" height="607" alt="rowboat-github-2" src="https://github.com/user-attachments/assets/fc463b99-01b3-401c-b4a4-044dad480901" />
</a>

<h5 align="center">

<p align="center" style="display: flex; justify-content: center; gap: 20px; align-items: center;">
  <a href="https://trendshift.io/repositories/13609" target="blank">
    <img src="https://trendshift.io/api/badge/repositories/13609" alt="rowboatlabs/rowboat | Trendshift" width="250" height="55"/>
  </a>
</p>

<p align="center">
    <a href="https://www.rowboatlabs.com/" target="_blank" rel="noopener">
    <img alt="Website" src="https://img.shields.io/badge/Website-10b981?labelColor=10b981&logo=window&logoColor=white">
  </a>
  <a href="https://discord.gg/wajrgmJQ6b" target="_blank" rel="noopener">
    <img alt="Discord" src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white&labelColor=5865F2">
  </a>
  <a href="https://x.com/intent/user?screen_name=rowboatlabshq" target="_blank" rel="noopener">
    <img alt="Twitter" src="https://img.shields.io/twitter/follow/rowboatlabshq?style=social">
  </a>
  <a href="https://www.ycombinator.com" target="_blank" rel="noopener">
    <img alt="Y Combinator" src="https://img.shields.io/badge/Y%20Combinator-S24-orange">
  </a>
</p>

# Rowboat  
**Open-source AI coworker that turns work into a knowledge graph and acts on it**

</h5>

> **Fork notice** — This is the [Oppulence-Engineering](https://github.com/Oppulence-Engineering) fork of [rowboatlabs/rowboat](https://github.com/rowboatlabs/rowboat). It ships independent builds with its own release cadence, telemetry pipeline, and update channel. See [Fork details](#fork-details) below.

Rowboat connects to your email and meeting notes, builds a long-lived knowledge graph, and uses that context to help you get work done - privately, on your machine.

You can do things like:
- `Build me a deck about our next quarter roadmap` → generates a PDF using context from your knowledge graph
- `Prep me for my meeting with Alex` → pulls past decisions, open questions, and relevant threads into a crisp brief (or a voice note)
- Track a person, company or topic through live notes
- Visualize, edit, and update your knowledge graph anytime (it’s just Markdown)
- Record voice memos that automatically capture and update key takeaways in the graph

Download latest for Mac/Windows/Linux: [Download](https://www.rowboatlabs.com/downloads)

⭐ If you find Rowboat useful, please star the repo. It helps more people find it.

## Demo
[![Demo](https://github.com/user-attachments/assets/8b9a859b-d4f1-47ca-9d1d-9d26d982e15d)](https://www.youtube.com/watch?v=7xTpciZCfpw)

[Watch the full video](https://www.youtube.com/watch?v=7xTpciZCfpw)

---

## Installation

**Download latest for Mac/Windows/Linux:** [Download](https://www.rowboatlabs.com/downloads)

**All release files:**   https://github.com/rowboatlabs/rowboat/releases/latest

### Google setup
To connect Google services (Gmail, Calendar, and Drive), follow [Google setup](https://github.com/rowboatlabs/rowboat/blob/main/google-setup.md).

### Voice input
To enable voice input and voice notes (optional), add a Deepgram API key in `~/.rowboat/config/deepgram.json`

### Voice output

To enable voice output (optional), add an ElevenLabs API key in `~/.rowboat/config/elevenlabs.json`

### Web search

To use Exa research search (optional), add the Exa API key in `~/.rowboat/config/exa-search.json`

### External tools

To enable external tools (optional), you can add any MCP server or use Composio tools by adding an API key in `~/.rowboat/config/composio.json`

All API key files use the same format:
```
{
  "apiKey": "<key>"
}
```

## What it does

Rowboat is a **local-first AI coworker** that can:
- **Remember** the important context you don’t want to re-explain (people, projects, decisions, commitments)
- **Understand** what’s relevant right now (before a meeting, while replying to an email, when writing a doc)
- **Help you act** by drafting, summarizing, planning, and producing real artifacts (briefs, emails, docs, PDF slides)

Under the hood, Rowboat maintains an **Obsidian-compatible vault** of plain Markdown notes with backlinks — a transparent “working memory” you can inspect and edit.

## Integrations

Rowboat builds memory from the work you already do, including:
- **Gmail** (email)
- **Google Calendar** 
- **Rowboat meeting notes** or **Fireflies**

It also contains a library of product integrations through Composio.dev

## How it’s different

Most AI tools reconstruct context on demand by searching transcripts or documents.

Rowboat maintains **long-lived knowledge** instead:
- context accumulates over time
- relationships are explicit and inspectable
- notes are editable by you, not hidden inside a model
- everything lives on your machine as plain Markdown

The result is memory that compounds, rather than retrieval that starts cold every time.

## What you can do with it

- **Meeting prep** from prior decisions, threads, and open questions
- **Email drafting** grounded in history and commitments
- **Docs & decks** generated from your ongoing context (including PDF slides)
- **Follow-ups**: capture decisions, action items, and owners so nothing gets dropped
- **On-your-machine help**: create files, summarize into notes, and run workflows using local tools (with explicit, reviewable actions)

## Live notes

Live notes are notes that stay updated automatically. You can create one by typing '@rowboat' on a note. 

- Track a competitor or market topic across X, Reddit, and the news
- Monitor a person, project, or deal across web or your communications
- Keep a running summary of any subject you care about

Everything is written back into your local Markdown vault. You control what runs and when.

## Bring your own model

Rowboat works with the model setup you prefer:
- **Local models** via Ollama or LM Studio
- **Hosted models** (bring your own API key/provider)
- Swap models anytime — your data stays in your local Markdown vault

## Extend Rowboat with tools (MCP)

Rowboat can connect to external tools and services via **Model Context Protocol (MCP)**.
That means you can plug in (for example) search, databases, CRMs, support tools, and automations - or your own internal tools.

Examples: Exa (web search), Twitter/X, ElevenLabs (voice), Slack, Linear/Jira, GitHub, and more.

## Local-first by design

- All data is stored locally as plain Markdown
- No proprietary formats or hosted lock-in
- You can inspect, edit, back up, or delete everything at any time

---
<div align="center">

[Discord](https://discord.gg/wajrgmJQ6b) · [Twitter](https://x.com/intent/user?screen_name=rowboatlabshq)
</div>


---

## Fork details

This fork is maintained independently of upstream. The substantive differences are confined to the desktop app under `apps/x/` plus the CI/release pipeline under `.github/workflows/`.

### Installation (this fork)

Download installers from this fork's releases page:

**Latest release:** https://github.com/Oppulence-Engineering/rowboat/releases/latest

Each release ships 16 installer assets covering the full Mac/Windows/Linux matrix (macOS `.dmg` and `.zip` for both arm64 and x64; Linux `.deb`, `.rpm`, and `.zip` for arm64 and x86_64; Windows Squirrel `.exe` installer plus a portable `.zip`), plus two supply-chain SBOMs (SPDX 2.3 and CycloneDX 1.5) so consumers can scan dependencies for known CVEs without rebuilding from source.

### Auto-update

The desktop app uses [`update-electron-app`](https://github.com/electron/update-electron-app) and is pointed at this fork's release feed (`Oppulence-Engineering/rowboat`). Installed clients check for new versions on startup and silently download in the background; the next launch boots into the new version. To opt out, quit and remove the app — no telemetry is sent past that point.

### Telemetry and crash reporting

This fork uses [PostHog](https://posthog.com/) for both product analytics and exception capture. The main process registers `process.on('uncaughtException')` and `process.on('unhandledRejection')` handlers that ship to `posthog-node`; the renderer enables `capture_exceptions: true` on the React provider so browser-side errors flow to `posthog-js` automatically. No third-party crash-reporting SDK is wired in. See [ANALYTICS.md](./ANALYTICS.md) for the full event taxonomy and opt-out instructions.

### Release process

Releases follow [Conventional Commits](https://www.conventionalcommits.org/). When a PR with a `feat:`, `fix:`, or `feat!:`/`fix!:` commit (squash-merged into `main`) touches `apps/x/`, [release-please](https://github.com/googleapis/release-please) automatically opens a release PR with the version bump and changelog entry. Merging that PR cuts a tag, triggers parallel macOS/Linux/Windows builds via electron-forge, attaches all 16 installer assets to the GitHub Release, and uploads SBOMs. Total wall-clock time is around 6 minutes.

### Upstream sync

Upstream changes are periodically merged in via `Sync fork` on the GitHub UI. Fork-specific files (anything under `.github/workflows/release.yml`, `apps/x/apps/main/forge.config.js`, `apps/x/packages/core/src/posthog.ts`, and this section of `README.md`) take precedence on conflict.

### Security

To report a vulnerability in this fork, see [SECURITY.md](./SECURITY.md) (email: admin@solomon-ai.co). Vulnerabilities in upstream code should be reported to [rowboatlabs/rowboat](https://github.com/rowboatlabs/rowboat) directly.
