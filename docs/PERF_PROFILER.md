# Performance profiler

The plugin instruments its own latency and reports it to a 6-hourly cron
watchdog, so "the chat feels slow" turns into trended numbers instead of a
one-off vibe check.

## What's measured

**Backend (per chat turn, `plugin_api.py` `stream_ws`)** — appended to
`perf/turns.jsonl`:
- `total_ms` — wall time from receiving the message to the `done` frame
- `first_delta_ms` — time to the first streamed token (the biggest lever for
  "feels laggy": everything before it is dead air with no visible progress)
- `ok` / failure — whether the turn errored
- `tool_calls`, `tool_names`, `input_chars`, `output_chars` — context for
  diagnosing *why* a slow turn was slow

**Frontend (typing latency, `src/index.jsx` `PerfTracker`)** — appended to
`perf/client.jsonl`:
- Measures keydown → next-paint latency (via double `requestAnimationFrame`),
  which captures the exact render+reflow cost of a keystroke, including
  markdown re-parse of unrelated messages if the `Bubble` memoization ever
  regresses.
- Batched client-side (p50/p95/max over ~20s windows) and sent as ONE beacon
  to `POST /perf/client` — never per-keystroke, since that would itself be a
  perf bug.

## Endpoints

- `POST /api/plugins/web-chat/perf/client` — frontend beacon sink
- `GET /api/plugins/web-chat/perf/summary?hours=24` — rolled-up stats for
  manual eyeballing or external tooling

## Cron watchdog

Job `webchat-perf-watchdog` (`hermes cron list`) runs every 6h:
1. `scripts/webchat-perf-check.sh` reads `perf/turns.jsonl` + `perf/client.jsonl`
   directly off disk (runs inside the hermes_hermes container, same
   filesystem the plugin writes to) and prints a JSON summary for the last 6h.
2. The agent compares against fixed regression thresholds
   (`turn_first_delta_ms.p95 > 3000`, `client_keystroke_p95_ms.p95 > 80`,
   any failures) using its notepad (`hermes cron notepad webchat-perf-watchdog`)
   to avoid re-flagging a steady-state number every run.
3. On a NEW/WORSENING regression: investigates the code, drafts a fix,
   builds (`node build.js`) and tests it, then opens a kanban card with the
   diagnosis + diff summary. **It never commits, pushes, or restarts
   anything** — the kanban card is the human approval gate.
4. On no regression: silently updates its notepad baseline and exits.

Perf logs are capped at ~5000 lines each (oldest trimmed) so they never grow
unbounded.
