# Gather server module

V3b agent registry, run journal, stage review, polite browser runner and cron-lite
scheduler live here. `scrape-classify` uses the shared browser server and Codex
structured output. `dedup-review` and `link-discovery` currently journal explicit
`not implemented` stub runs.

Every registry record has a Gather v2 `kind`: `discover-company`, `discover-person`
or `enrich`. Registries created before Gather v2 remain valid and default to
`enrich`. The bundled `*.agent.yaml` files are disabled manual templates; copy the
needed records into a workspace's `agents.yaml` to configure them.
