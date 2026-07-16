const STEPS = [
  {
    n: "01",
    title: "Seed",
    desc: "Point agents at a source — Google Places, SERP, a directory — and a target profile.",
  },
  {
    n: "02",
    title: "Discover",
    desc: "Agents crawl via the shared browser, extract candidate people and organizations.",
  },
  {
    n: "03",
    title: "Enrich & score",
    desc: "Resolve mails, hooks and relations; score each lead against your criteria.",
  },
  {
    n: "04",
    title: "Merge to network",
    desc: "Deduplicate and land new nodes into the graph, ready for outreach.",
  },
];

export default function GatherView() {
  return (
    <div className="view-pad gather">
      <div className="gather-hero">
        <div className="gather-badge">Coming soon</div>
        <h1>Gathering agents</h1>
        <p className="gather-lead">
          An autonomous pipeline that grows the network for you. Configure a
          flow of agents that discover, enrich and score new leads — then merge
          them into your graph. A visual, n8n-style flow builder lands in V3.
        </p>
      </div>

      <div className="gather-flow">
        {STEPS.map((s, i) => (
          <div key={s.n} className="gather-node-wrap">
            <div className="gather-node">
              <span className="gather-n">{s.n}</span>
              <div className="gather-node-title">{s.title}</div>
              <div className="gather-node-desc">{s.desc}</div>
            </div>
            {i < STEPS.length - 1 && <span className="gather-arrow">→</span>}
          </div>
        ))}
      </div>

      <div className="gather-foot">
        The flow above is illustrative. Agent runs, live status and editing
        arrive with the V3 flow builder.
      </div>
    </div>
  );
}
