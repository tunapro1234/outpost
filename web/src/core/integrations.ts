export type IntegrationStatus = "connected" | "planned" | "configure";

export interface Integration {
  id: string;
  name: string;
  desc: string;
  status: IntegrationStatus;
  detail: string;
}

export const STATUS_META: Record<
  IntegrationStatus,
  { label: string; tone: string }
> = {
  connected: { label: "connected", tone: "ok" },
  planned: { label: "planned", tone: "muted" },
  configure: { label: "configure", tone: "warn" },
};

export const INTEGRATIONS: Integration[] = [
  {
    id: "browser",
    name: "Central Browser Server",
    desc: "Shared Playwright session; the discovery and verification scraper uses this bridge.",
    status: "connected",
    detail:
      "The scraper module connects to a shared Chromium server (ws bridge). Page loading, screenshots and DOM reads all run through one hub.",
  },
  {
    id: "gitea",
    name: "Gitea",
    desc: "Repo tunapro/outpost — version control and data history.",
    status: "connected",
    detail:
      "Person/org notes and the index are versioned on Gitea. A watcher tracks changes.",
  },
  {
    id: "mail-send",
    name: "Mail sending",
    desc: "Human-approved sending pipeline.",
    status: "planned",
    detail:
      "Draft → approval → send flow. Not in v2; the Mails tab is read-only for now. Coming soon.",
  },
  {
    id: "mail-verify",
    name: "Mail verification",
    desc: "Address verification via Hunter / ZeroBounce / Prospeo.",
    status: "planned",
    detail:
      "Validate deliverability of discovered addresses with third-party services. Coming soon.",
  },
  {
    id: "google-places",
    name: "Google Places",
    desc: "Discovery source — venue and organization data.",
    status: "planned",
    detail:
      "Places API for geographic discovery. Automatic collection of new candidate organizations. Coming soon.",
  },
  {
    id: "serper",
    name: "Serper.dev",
    desc: "SERP data — search-result enrichment.",
    status: "planned",
    detail:
      "Programmatic search results to enrich hooks and sources. Coming soon.",
  },
  {
    id: "obsidian",
    name: "Obsidian vault",
    desc: "Data source — person/org markdown notes.",
    status: "connected",
    detail:
      "The network's raw data is derived from markdown files in the Obsidian vault. A watcher indexes them.",
  },
];
