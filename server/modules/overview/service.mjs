import { networkStats } from "../network/service.mjs";
import { entityStateMap, workspaceNetworkId } from "../network/service.mjs";
import { reachStats, workspaceTrafficMails } from "../reach/mails.mjs";
import { hasMail, mailAddresses, reachCandidateEntities } from "../reach/service.mjs";
import { listRuns } from "../gather/journal.mjs";
import { GATHER_KINDS, readAgentRegistry } from "../gather/registry.mjs";
import { stageStats } from "../gather/stage.mjs";
import { openWorkspaceDb } from "../../lib/db.mjs";
import { workspaceNetworkView } from "../../lib/config.mjs";

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
  // outreach = vault'taki bir entity'yle eşleşen trafik; mailbox'taki alakasız
  // gönderimler (tedarikçi teklifi, test maili) KPI'lara sayılmaz
  const outgoing = mails.filter((mail) => mail.direction === "out" && mail.entity_id);
  const matched = reachStats(mails);
  const mailbox = {
    sent: mails.filter((mail) => mail.direction === "out").length,
    received: mails.filter((mail) => mail.direction === "in").length,
  };
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
      sent: matched.sent,
      replied: matched.replied,
    },
    mailbox,
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

const CHANNEL_TITLES = {
  whatsapp: "WhatsApp mesajı",
  mail: "Mail",
  telefon: "Telefon görüşmesi",
  yuzyuze: "Yüz yüze görüşme",
  diger: "Temas",
};

function realTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function entityName(workspace, entityId, fallback = null) {
  return workspace.index.entities.get(entityId)?.meta?.name ?? fallback ?? entityId;
}

async function recentActivity(workspace) {
  const db = openWorkspaceDb(workspace);
  const network = workspaceNetworkId(workspace);
  const items = [];

  for (const row of db.prepare(
    `SELECT entity_id, channel, direction, at
     FROM interaction
     WHERE workspace = ? AND network = ?`,
  ).all(workspace.id, network)) {
    const at = realTimestamp(row.at);
    if (!at) continue;
    const name = entityName(workspace, row.entity_id);
    items.push({
      kind: "interaction",
      at,
      title: `${CHANNEL_TITLES[row.channel]} — ${name}${row.direction === "in" ? "'ten" : "'e"}`,
      entity_id: row.entity_id,
      channel: row.channel,
    });
  }

  for (const row of db.prepare(
    `SELECT s.sent_at, m.person_id, m.company_id, m.to_addr
     FROM mail_send AS s
     JOIN mail AS m ON m.id = s.mail_id
     WHERE s.status = 'sent'`,
  ).all()) {
    const at = realTimestamp(row.sent_at);
    if (!at) continue;
    const entityId = row.person_id ?? row.company_id ?? null;
    const name = entityId
      ? entityName(workspace, entityId, row.to_addr)
      : row.to_addr ?? "bilinmeyen alıcı";
    items.push({
      kind: "mail_send",
      at,
      title: `Mail gönderildi — ${name}'e`,
      ...(entityId ? { entity_id: entityId } : {}),
      channel: "mail",
    });
  }

  for (const run of await listRuns(workspace)) {
    const at = realTimestamp(run.ended);
    if (!at) continue;
    items.push({
      kind: "gather_run",
      at,
      title: `Toplama tamamlandı — ${run.agent_id}`,
    });
  }

  for (const row of db.prepare(
    `SELECT entity_id, updated_at
     FROM entity_status
     WHERE workspace = ? AND network = ? AND state_source = 'manual'`,
  ).all(workspace.id, network)) {
    const at = realTimestamp(row.updated_at);
    if (!at) continue;
    items.push({
      kind: "entity_status",
      at,
      title: `Durum güncellendi — ${entityName(workspace, row.entity_id)}`,
      entity_id: row.entity_id,
    });
  }

  return items
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, 20);
}

export async function overviewMetrics(workspace, { now } = {}) {
  const [mails, gather] = await Promise.all([
    workspaceTrafficMails(workspace),
    gatherMetrics(workspace),
  ]);
  const networkViews = !workspace.networkId && Array.isArray(workspace.networks)
    ? workspace.networks.map((network) => workspaceNetworkView(workspace, network))
    : [workspace];
  const stateByEntity = new Map();
  for (const networkWorkspace of networkViews) {
    for (const [entityId, entityState] of entityStateMap(networkWorkspace, mails)) {
      const current = stateByEntity.get(entityId);
      if (
        !current ||
        (Number.isInteger(entityState.state) &&
          (!Number.isInteger(current.state) || entityState.state > current.state))
      ) {
        stateByEntity.set(entityId, entityState);
      }
    }
  }
  const stateHistogram = Object.fromEntries(
    Array.from({ length: 6 }, (_, state) => [state, 0]),
  );
  let reached = 0;
  for (const { state } of stateByEntity.values()) {
    if (Number.isInteger(state) && state >= 0 && state <= 5) stateHistogram[state] += 1;
    if (Number.isInteger(state) && state >= 2) reached += 1;
  }
  const candidates = reachCandidateEntities(workspace.index, mails).length;
  const outreach = outreachMetrics(mails, { ...(now ? { now } : {}) });
  return {
    totals: totalMetrics(workspace.index),
    outreach: {
      ...outreach,
      reached,
      stateHistogram,
    },
    gather,
    reach: { candidates },
    recentActivity: await recentActivity(workspace),
  };
}
