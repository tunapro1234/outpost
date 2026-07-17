import { openSse } from "../../lib/sse.mjs";
import { redactSecrets } from "../copilot/context.mjs";
import { resolveThreadId } from "../copilot/threads.mjs";
import { UserStore } from "../profile/service.mjs";
import { createAssistantTmuxBridge, prepareAssistant } from "./tmux-bridge.mjs";
import { personalAgentSession } from "./service.mjs";
import { appendUsage } from "../mailer/usage.mjs";

const SAFE_USERNAME = /^[a-z0-9-]{1,24}$/;

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function authenticatedUser(request, defaultUser) {
  const header = request.headers["x-remote-user"];
  const username = header === undefined ? defaultUser : header;
  if (!username) fail(401, "authentication required");
  if (typeof username !== "string" || !SAFE_USERNAME.test(username)) {
    fail(400, "Geçersiz kullanıcı adı");
  }
  return username;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail(400, "JSON gövdesi nesne olmalı");
  }
  if (typeof payload.message !== "string" || !payload.message.trim()) {
    fail(400, "message zorunlu");
  }
  return {
    message: payload.message.trim(),
    threadId: resolveThreadId(payload.thread_id),
  };
}

function publicError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message).replace(/\s+/g, " ").trim().slice(0, 1000) ||
    "Asistan kullanılamadı";
}

async function sendEvent(reply, payload) {
  if (reply.raw.destroyed || reply.raw.writableEnded) return false;
  if (reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)) return true;
  await new Promise((resolve) => reply.raw.once("drain", resolve));
  return !reply.raw.destroyed;
}

export async function assistantRoutes(app, {
  resolveWorkspace,
  defaultUser = process.env.OUTPOST_DEFAULT_USER,
  exec,
  fileSystem,
  sleep,
  claudeBin,
  briefTemplatePath,
  spawnWaitMs,
  bridgeOptions,
  usersPath = process.env.OUTPOST_USERS,
}) {
  const bridges = new Map();
  const users = usersPath ? new UserStore(usersPath) : null;

  async function sessionFor(workspace, user) {
    let displayName = user;
    if (users) {
      try {
        displayName = (await users.get(user)).name || user;
      } catch (error) {
        if (error?.statusCode !== 404) throw error;
      }
    }
    return personalAgentSession(workspace, displayName, user);
  }

  function bridgeFor(workspace, user, session) {
    const key = `${workspace.id}\0${user}\0${session}`;
    let bridge = bridges.get(key);
    if (!bridge) {
      bridge = createAssistantTmuxBridge({
        user,
        session,
        exec,
        fileSystem,
        sleep,
        claudeBin,
        briefTemplatePath,
        spawnWaitMs,
        logger: app.log,
        ...bridgeOptions,
      });
      bridges.set(key, bridge);
    }
    return bridge;
  }

  app.post("/assistant", async (request, reply) => {
    const user = authenticatedUser(request, defaultUser);
    const workspace = resolveWorkspace(request);
    const { message, threadId } = validatePayload(request.body);

    openSse(reply);

    const abortController = new AbortController();
    let clientClosed = false;
    let output = "";
    reply.raw.once("close", () => {
      clientClosed = !reply.raw.writableEnded;
      if (clientClosed) abortController.abort();
    });

    try {
      await prepareAssistant(workspace, user, { fileSystem, briefTemplatePath });
      const session = await sessionFor(workspace, user);
      const stream = await bridgeFor(workspace, user, session)(message, {
        signal: abortController.signal,
        workspace,
        user,
      });
      if (!stream) throw new Error("Asistan tmux oturumu hazır değil veya meşgul");
      for await (const rawDelta of stream) {
        const delta = String(rawDelta ?? "");
        output += delta;
        if (delta && !await sendEvent(reply, { delta })) break;
      }
      await appendUsage(workspace, {
        user,
        agent: "assistant",
        kind: "chat",
        chars_in: message.length,
        chars_out: output.length,
      }, { fileSystem }).catch((error) =>
        app.log.warn({ err: error }, "Assistant usage yazılamadı"));
    } catch (error) {
      if (!clientClosed) await sendEvent(reply, { error: publicError(error) });
    } finally {
      if (!clientClosed) {
        await sendEvent(reply, { done: true, thread_id: threadId });
        reply.raw.end();
      }
    }
  });
}
