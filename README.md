# nightly-research

> A nightly equity-research analyst that runs on **your own machine** — one AI agent per ticker, ~$0 marginal cost.

![nightly-research — research agents working your watchlist overnight](https://raw.githubusercontent.com/eyal-gor/p_102_nightly_research/main/hero.png)

Point it at a watchlist. Every night it runs a research agent for each ticker, updates a living profile, and writes you a digest of **what changed** — so the companies whose story keeps improving rise to the top over time.

It runs on your own compute through **[cerver](https://cerver.ai)**, on the Claude/Codex subscription you already pay for. So researching 50 tickers every night costs roughly nothing — instead of a metered API bill that scales with every step the agents take.

```
nightly add AAPL NVDA TSM ASML
nightly run                 # researches every ticker tonight, on your machine
nightly digest              # what changed — improving stories first
```

## Why this exists

Agentic research is token-hungry: 50 tickers × nightly × multi-step reasoning is a real monthly bill on a metered API. `nightly-research` hands each ticker to **cerver**, which runs the agent on hardware you own and bills it to your flat-rate subscription. Marginal cost ≈ **$0**, so you can afford to research broadly and let the signal accumulate.

## How it works

1. `watchlist.json` holds your tickers.
2. `nightly run` spawns **one cerver agent per ticker** (in parallel), each updating `profiles/<TICKER>.md`.
3. Each profile carries a **Score (1–10)** plus a dated `## History`; reviews append a new entry and move the score.
4. A digest lands in `digests/<date>.md` ranking by score and surfacing **rising scores** — the signal that matters more than the absolute number.
5. Schedule it nightly with cron or launchd (below).

## Install

**1. Install cerver** (the orchestration layer) and log in:

```bash
curl -fsSL https://cerver.ai/install.sh | bash
cerver login
```

**2. Get this repo** and link the `nightly` command:

```bash
git clone https://github.com/eyal-gor/p_102_nightly_research
cd p_102_nightly_research
npm link          # gives you `nightly`; or just run `node bin/nightly.mjs <cmd>`
```

> **Before your first `nightly run`:** the research commands spawn real agents, so cerver needs a logged-in model (`claude login`) and **one ready compute**. Confirm with `cerver computes` — you want a `ready` row (your own machine via the relay, or a cloud sandbox). The **dashboard and chat work without any of this** (anonymous), so you can try those immediately.

## Commands

```
nightly run [TICKER...]   research the watchlist (or given tickers) → profiles + digest
nightly add TICKER...     add to the watchlist
nightly rm  TICKER...     remove from the watchlist
nightly list              show the watchlist
nightly digest            print the latest digest
nightly dashboard         scored watchlist dashboard in the browser (with a guided tour)
nightly chat              chat with your watchlist — "which looks best and why?"
```

Config via env:

```
NIGHTLY_CLI=claude|codex|grok    which harness runs the research (default: claude)
NIGHTLY_COMPUTE=<name>           cerver compute to run on (default: cerver picks one)
NIGHTLY_CONCURRENCY=4            how many agents run at once
```

## Dashboard & chat

```
nightly dashboard   # scored watchlist + profile reader + a chat docked in the corner
nightly chat        # just the chat, full-width
```

Both render a local page with an embedded **[cerver-chat](https://github.com/eyal-gor/p_103_cerver_chat)** widget — multi-model (switch live), streaming, with conversation memory — primed on your own research so you can ask about your watchlist. With **zero setup** it runs on a shared free-trial session (cheap model, a small global daily cap — fine for a taste, may be used up at busy times). Run `cerver login` or set a key (below) to run it on **your own** account: your model, your compute, no shared cap.

To run the chat under *your* cerver account (so the sessions show in your dashboard, on your compute/models), set your nightly-research app key:

```bash
export NIGHTLY_CERVER_KEY=<your nightly-research app key>   # from cerver.ai → API keys
nightly dashboard
```

## Scheduling (the "nightly")

**cron** (2am daily):

```cron
0 2 * * * cd /path/to/nightly-research && /usr/bin/env nightly run >> nightly.log 2>&1
```

**macOS launchd** — drop `com.nightly-research.plist` in `~/Library/LaunchAgents` running `nightly run` on a `StartCalendarInterval`. (Sample in `docs/`.)

## cerver — the orchestration layer

`nightly-research` never talks to a model API directly. It hands each research task to cerver, which:

- runs the agent (`claude` by default) on a **compute you choose** — your laptop, a mini, a cloud sandbox,
- bills it to **your subscription**, not per token,
- lets you swap the model (`NIGHTLY_CLI=codex`) or move the work to another machine without changing a line.

That's the whole trick: the agent fleet is free to run because it runs on what you already own and pay for.

## Not financial advice

This produces research notes from an AI agent. It can be wrong, stale, or confidently incorrect. Do your own work before risking money.

## License

MIT
