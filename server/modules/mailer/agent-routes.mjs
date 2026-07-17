import { promises as fs } from "node:fs";
import path from "node:path";
import { redactSecrets } from "../copilot/context.mjs";
import { resolveThreadId } from "../copilot/threads.mjs";
import { personalAgentSession } from "../assistant/service.mjs";
import { personalAgentExec } from "../../lib/personal-agent-session.mjs";
import { authenticatedMailerUser, mailerUsers } from "./auth.mjs";
import { readCalibration, writeCalibration } from "./calibration.mjs";
import {
  createMailAgentBridge,
  ensureMailAgentBrief,
  mailAgentSession,
} from "./mail-agent.mjs";
import { userStats } from "./stats.mjs";
import { appendUsage } from "./usage.mjs";

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function chatPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail(400, "JSON gövdesi nesne olmalı");
  }
  if (typeof payload.message !== "string" || !payload.message.trim()) fail(400, "message zorunlu");
  return { message: payload.message.trim(), threadId: resolveThreadId(payload.thread_id) };
}

function publicError(error) {
  return redactSecrets(error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ").trim().slice(0, 1000) || "Mail agent kullanılamadı";
}

async function sendEvent(reply, payload) {
  if (reply.raw.destroyed || reply.raw.writableEnded) return false;
  if (reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)) return true;
  await new Promise((resolve) => reply.raw.once("drain", resolve));
  return !reply.raw.destroyed;
}

async function lastActivity(workspace, kind, user) {
  const directory = path.join(workspace.directory, kind === "assistant" ? "assistant" : "mailagent", user, "outbox");
  try {
    return (await fs.stat(directory)).mtime.toISOString();
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function sessionRunning(session, exec) {
  try {
    await exec("tmux", ["has-session", "-t", `=${session}`]);
    return true;
  } catch {
    return false;
  }
}

export async function mailAgentRoutes(app, {
  resolveWorkspace,
  defaultUser,
  usersPath = process.env.OUTPOST_USERS,
  exec = personalAgentExec,
  fileSystem,
  sleep,
  claudeBin,
  briefTemplatePath,
  spawnWaitMs,
  bridgeOptions,
  now = () => new Date(),
}) {
  const bridges = new Map();

  async function profile(user) {
    const users = await mailerUsers({ usersPath, defaultUser });
    return users.find((candidate) => candidate.user === user) ?? {
      user, name: user, role: "",
    };
  }

  function bridgeFor(workspace, user, session) {
    const key = `${workspace.id}\0${user}\0${session}`;
    let bridge = bridges.get(key);
    if (!bridge) {
      bridge = createMailAgentBridge({
        user, session, exec, fileSystem, sleep, claudeBin, spawnWaitMs,
        logger: app.log, ...bridgeOptions,
      });
      bridges.set(key, bridge);
    }
    return bridge;
  }

  app.post("/mailagent", async (request, reply) => {
    const user = authenticatedMailerUser(request, defaultUser);
    const workspace = resolveWorkspace(request);
    const { message, threadId } = chatPayload(request.body);
    const userProfile = await profile(user);
    const session = mailAgentSession(workspace, userProfile.name, user);

    reply.raw.statusCode = 200;
    reply.raw.setHeader("content-type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("cache-control", "no-cache, no-transform");
    reply.raw.setHeader("connection", "keep-alive");
    reply.raw.setHeader("x-accel-buffering", "no");
    reply.hijack();
    const abortController = new AbortController();
    let clientClosed = false;
    let output = "";
    reply.raw.once("close", () => {
      clientClosed = !reply.raw.writableEnded;
      if (clientClosed) abortController.abort();
    });
    try {
      await ensureMailAgentBrief(workspace, user, {
        fileSystem, templatePath: briefTemplatePath,
      });
      const stream = await bridgeFor(workspace, user, session)(message, {
        signal: abortController.signal, workspace, user,
      });
      if (!stream) throw new Error("Mail agent tmux oturumu hazır değil veya meşgul");
      for await (const rawDelta of stream) {
        const delta = String(rawDelta ?? "");
        output += delta;
        if (delta && !await sendEvent(reply, { delta })) break;
      }
      await appendUsage(workspace, {
        ts: now().toISOString(), user, agent: "mail", kind: "chat",
        chars_in: message.length, chars_out: output.length,
      }, { fileSystem }).catch((error) => app.log.warn({ err: error }, "Mail agent usage yazılamadı"));
    } catch (error) {
      if (!clientClosed) await sendEvent(reply, { error: publicError(error) });
    } finally {
      if (!clientClosed) {
        await sendEvent(reply, { done: true, thread_id: threadId });
        reply.raw.end();
      }
    }
  });

  app.get("/calibration", async (request) => {
    const user = authenticatedMailerUser(request, defaultUser);
    return readCalibration(resolveWorkspace(request), user);
  });
  app.put("/calibration", async (request) => {
    const user = authenticatedMailerUser(request, defaultUser);
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
      fail(400, "JSON gövdesi nesne olmalı");
    }
    return writeCalibration(resolveWorkspace(request), user, request.body.content, { now });
  });
  app.get("/users/stats", async (request) =>
    userStats(resolveWorkspace(request), { usersPath, defaultUser }));
  app.get("/personal-agents", async (request) => {
    const user = authenticatedMailerUser(request, defaultUser);
    const workspace = resolveWorkspace(request);
    const userProfile = await profile(user);
    const records = [
      { kind: "assistant", session: personalAgentSession(workspace, userProfile.name, user) },
      { kind: "mail", session: mailAgentSession(workspace, userProfile.name, user) },
    ];
    return Promise.all(records.map(async (record) => ({
      ...record,
      running: await sessionRunning(record.session, exec),
      lastActivity: await lastActivity(workspace, record.kind, user),
    })));
  });
}
