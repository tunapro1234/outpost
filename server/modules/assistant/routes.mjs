import { redactSecrets } from "../copilot/context.mjs";
import { resolveThreadId } from "../copilot/threads.mjs";
import { createAssistantTmuxBridge, prepareAssistant } from "./tmux-bridge.mjs";

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
}) {
  const bridges = new Map();

  function bridgeFor(user) {
    let bridge = bridges.get(user);
    if (!bridge) {
      bridge = createAssistantTmuxBridge({
        user,
        exec,
        fileSystem,
        sleep,
        claudeBin,
        briefTemplatePath,
        spawnWaitMs,
        logger: app.log,
        ...bridgeOptions,
      });
      bridges.set(user, bridge);
    }
    return bridge;
  }

  app.post("/assistant", async (request, reply) => {
    const user = authenticatedUser(request, defaultUser);
    const workspace = resolveWorkspace(request);
    const { message, threadId } = validatePayload(request.body);

    reply.raw.statusCode = 200;
    reply.raw.setHeader("content-type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("cache-control", "no-cache, no-transform");
    reply.raw.setHeader("connection", "keep-alive");
    reply.raw.setHeader("x-accel-buffering", "no");
    reply.hijack();

    const abortController = new AbortController();
    let clientClosed = false;
    reply.raw.once("close", () => {
      clientClosed = !reply.raw.writableEnded;
      if (clientClosed) abortController.abort();
    });

    try {
      await prepareAssistant(workspace, user, { fileSystem, briefTemplatePath });
      const stream = await bridgeFor(user)(message, {
        signal: abortController.signal,
        workspace,
        user,
      });
      if (!stream) throw new Error("Asistan tmux oturumu hazır değil veya meşgul");
      for await (const rawDelta of stream) {
        const delta = String(rawDelta ?? "");
        if (delta && !await sendEvent(reply, { delta })) break;
      }
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
