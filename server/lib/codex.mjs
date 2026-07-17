export function codexServiceTierArgs(agent) {
  return agent?.params?.service_tier === "fast"
    ? ["-c", 'service_tier="fast"']
    : [];
}
