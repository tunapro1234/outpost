import { networkStats } from "../network/service.mjs";
import { workspaceTrafficMails } from "../reach/mails.mjs";
import { hasMail, mailAddresses, reachCandidateCount } from "../reach/service.mjs";
import { listRuns } from "../gather/journal.mjs";
import { GATHER_KINDS, readAgentRegistry } from "../gather/registry.mjs";
import { stageStats } from "../gather/stage.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_DAYS = 30;

function parsedDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function utcDay(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function recipientKeys(mail) {
  const addresses = mailAddresses(mail.peer ?? mail.to);
  if (addresses.length) return addresses.map((address) => `address:${address}`);
  if (mail.person_id) return [`person:${mail.person_id}`];
  return mail.entity_id ? [`entity:${mail.entity_id}`] : [];
}

export function outreachMetrics(mails, { now = () => new Date() } = {}) {
  const outgoing = mails.filter((mail) => mail.direction === "out");
  const dated = outgoing
    .map((mail) => ({ value: mail.date, date: parsedDate(mail.date) }))
    .filter((entry) => entry.date !== null)
    .sort((left, right) => left.date - right.date);
  const activeDates = new Set(dated.map((entry) => dayKey(utcDay(entry.date))));
  const recipients = new Set(outgoing.flatMap(recipientKeys));

  const today = utcDay(now());
  const firstDay = today - (DAILY_DAYS - 1) * DAY_MS;
  const dailyByDate = new Map();
  for (let cursor = firstDay; cursor <= today; cursor += DAY_MS) {
    dailyByDate.set(dayKey(cursor), 0);
  }
  for (const entry of dated) {
    const timestamp = utcDay(entry.date);
    if (timestamp < firstDay || timestamp > today) continue;
    const key = dayKey(timestamp);
    dailyByDate.set(key, dailyByDate.get(key) + 1);
  }

  return {
    mailsSent: outgoing.length,
    uniqueRecipients: recipients.size,
    firstMailAt: dated[0]?.value ?? null,
    lastMailAt: dated.at(-1)?.value ?? null,
    activeDays: activeDates.size,
    avgPerActiveDay: activeDates.size ? outgoing.length / activeDates.size : 0,
    daily: [...dailyByDate].map(([date, count]) => ({ date, count })),
    byStatus: {
      sent: outgoing.length,
      replied: mails.filter((mail) => mail.direction === "in").length,
    },
  };
}

async function gatherMetrics(workspace) {
  const [{ counts }, agents, runs] = await Promise.all([
    stageStats(workspace, GATHER_KINDS),
    readAgentRegistry(workspace),
    listRuns(workspace),
  ]);
  const latestByAgent = new Map();
  for (const run of runs) {
    if (!latestByAgent.has(run.agent_id)) latestByAgent.set(run.agent_id, run);
  }
  return {
    staged: Object.values(counts).reduce((total, value) => total + value.staged, 0),
    acceptedTotal: Object.values(counts).reduce((total, value) => total + value.accepted, 0),
    agents: agents.length,
    running: agents.filter((agent) => latestByAgent.get(agent.id)?.status === "running").length,
  };
}

function totalMetrics(index) {
  const stats = networkStats(index);
  let withMail = 0;
  for (const entity of index.entities.values()) {
    if (hasMail(entity)) withMail += 1;
  }
  return {
    entities: stats.total,
    byType: stats.byType,
    withMail,
    withoutMail: stats.total - withMail,
  };
}

export async function overviewMetrics(workspace, { now } = {}) {
  const [mails, gather, candidates] = await Promise.all([
    workspaceTrafficMails(workspace),
    gatherMetrics(workspace),
    reachCandidateCount(workspace),
  ]);
  return {
    totals: totalMetrics(workspace.index),
    outreach: outreachMetrics(mails, { ...(now ? { now } : {}) }),
    gather,
    reach: { candidates },
  };
}
