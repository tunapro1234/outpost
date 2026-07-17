import { openSse } from "../../lib/sse.mjs";
import { buildCopilotPrompt, redactSecrets, workspaceSummary } from "./context.mjs";
import { appendThreadMessage, readThread, resolveThreadId } from "./threads.mjs";
import { createTmuxBridge } from "./tmux-bridge.mjs";

function remoteUser(request, defaultUser = process.env.OUTPOST_DEFAULT_USER) {
  const value = request.headers["x-remote-user"];
  return value === undefined ? (defaultUser || undefined) : value;
}

export function copilotEnabled(request, defaultUser) {
  return remoteUser(request, defaultUser) === "tuna";
}

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
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
    "Copilot kullanılamadı";
}

async function sendEvent(reply, payload) {
  if (reply.raw.destroyed || reply.raw.writableEnded) return false;
  if (reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)) return true;
  await new Promise((resolve) => reply.raw.once("drain", resolve));
  return !reply.raw.destroyed;
}

export async function copilotRoutes(app, {
  resolveWorkspace,
  runner,
  defaultUser = process.env.OUTPOST_DEFAULT_USER,
  tmuxBridge = createTmuxBridge({ logger: app.log }),
}) {
  app.get("/copilot/enabled", async (request) => {
    resolveWorkspace(request);
    return { enabled: copilotEnabled(request, defaultUser) };
  });

  app.post("/copilot", async (request, reply) => {
    const username = remoteUser(request, defaultUser);
    if (username === undefined) {
      return reply.code(401).send({ error: "authentication required" });
    }
    if (username !== "tuna") {
      return reply.code(403).send({ error: "copilot is owner-only" });
    }
    const workspace = resolveWorkspace(request);
    const { message, threadId } = validatePayload(request.body);

    openSse(reply);

    const abortController = new AbortController();
    let clientClosed = false;
    reply.raw.once("close", () => {
      clientClosed = !reply.raw.writableEnded;
      if (clientClosed) abortController.abort();
    });

    let assistant = "";
    try {
      const history = await readThread(workspace, threadId);
      await appendThreadMessage(workspace, threadId, "user", message);
      const summary = await workspaceSummary(workspace);
      const prompt = buildCopilotPrompt({ summary, history, message });
      const runOptions = { signal: abortController.signal, workspace };
      const stream = await tmuxBridge(prompt, runOptions) ?? await runner(prompt, runOptions);
      for await (const rawDelta of stream) {
        const delta = String(rawDelta ?? "");
        if (!delta) continue;
        assistant += delta;
        if (!await sendEvent(reply, { delta })) break;
      }
      await appendThreadMessage(workspace, threadId, "assistant", assistant);
    } catch (error) {
      if (assistant) {
        await appendThreadMessage(workspace, threadId, "assistant", assistant).catch(() => {});
      }
      if (!clientClosed) await sendEvent(reply, { error: publicError(error) });
    } finally {
      if (!clientClosed) {
        await sendEvent(reply, { done: true, thread_id: threadId });
        reply.raw.end();
      }
    }
  });
}
