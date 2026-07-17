import { promises as fs } from "node:fs";
import path from "node:path";
import { redactSecrets } from "../copilot/context.mjs";
import { resolveThreadId } from "../copilot/threads.mjs";
import { personalAgentSession } from "../assistant/service.mjs";
import { personalAgentExec } from "../../lib/personal-agent-session.mjs";
import { authenticatedMailerUser, mailerUsers } from "./auth.mjs";
import {
  readCalibration,
  readCalibrationSource,
  writeCalibration,
} from "./calibration.mjs";
import { recordCalibrationDraft } from "./calibration-sessions.mjs";
import { buildPersonBrief, briefContextText } from "./brief.mjs";
import {
  createMailAgentBridge,
  ensureMailAgentBrief,
  mailAgentSession,
} from "./mail-agent.mjs";
import { readMailAgentConfig, writeMailAgentConfig } from "./model-config.mjs";
import { hasMail } from "../reach/service.mjs";
import { loadSignals } from "./service.mjs";
import { userStats } from "./stats.mjs";
import {
  deleteUserSkill,
  listUserSkills,
  readUserSkillsPrompt,
  writeUserSkill,
} from "./user-skills.mjs";
import { appendUsage, estimatedUsage } from "./usage.mjs";
import {
  calibrationDraftPrompt,
  codexText,
  parseCalibrationDraft,
  readMailSkills,
  streamCalibrationDraft,
} from "./writer.mjs";

// The studio writes a SINGLE draft, so the full four-file skill set (~19 KB,
// incl. the irrelevant variants.md) is wasteful and pushes claude's time-to-
// first-token past 30s. A distilled ruleset (~5.5 KB) keeps every canonical
// rule but cuts first-token dramatically. See calibration-studio.md.
const STUDIO_SKILLS = ["calibration-studio.md"];

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

function calibrationDraftPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail(400, "JSON gövdesi nesne olmalı");
  }
  if (typeof payload.person_id !== "string" || !payload.person_id.trim()) {
    fail(400, "person_id zorunlu");
  }
  let feedback;
  if (payload.feedback !== undefined) {
    if (!payload.feedback || typeof payload.feedback !== "object" || Array.isArray(payload.feedback) ||
      !Number.isInteger(payload.feedback.rating) || payload.feedback.rating < 1 ||
      payload.feedback.rating > 5) {
      fail(400, "feedback.rating 1-5 arasında tam sayı olmalı");
    }
    feedback = { rating: payload.feedback.rating };
    for (const field of ["liked", "disliked"]) {
      if (payload.feedback[field] === undefined) continue;
      if (typeof payload.feedback[field] !== "string") fail(400, `${field} metin olmalı`);
      feedback[field] = payload.feedback[field].trim().slice(0, 4_000);
    }
  }
  return { personId: payload.person_id.trim(), feedback };
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

import { openSse } from "../../lib/sse.mjs";

function startSse(reply) {
  return openSse(reply);
}

function generatedResult(result) {
  return result && typeof result === "object" && !Array.isArray(result) && "text" in result
    ? result
    : { text: String(result ?? ""), usage: null };
}

function gptFeedbackPrompt(feedback, voice) {
  return `Aşağıdaki Studio geri bildirimini mevcut mail voice metnine işle. Yalnız JSON döndür: {"content":"güncellenmiş markdown gövdesi"}. Frontmatter ekleme. Mevcut tercihleri koru; yalnız geri bildirimden güvenle çıkarılabilen kuralları ekle veya düzelt.\n\nGERİ BİLDİRİM:\n${JSON.stringify(feedback, null, 2)}\n\nMEVCUT VOICE:\n${voice}`;
}

function parseVoiceUpdate(output) {
  const text = String(output ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (firstError) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw firstError;
    parsed = JSON.parse(text.slice(start, end + 1));
  }
  if (typeof parsed?.content !== "string") throw new Error("Voice güncellemesi content içermeli");
  return parsed.content;
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
  fileSystem = fs,
  sleep,
  claudeBin,
  briefTemplatePath,
  spawnWaitMs,
  bridgeOptions,
  bridge: suppliedBridge,
  runCodex = codexText,
  runClaudeDraft = streamCalibrationDraft,
  buildBrief = buildPersonBrief,
  contextAgent = { id: "mail-calibration", model: "gpt-5.6-luna", params: {} },
  now = () => new Date(),
}) {
  const bridges = new Map();

  if (!app.hasContentTypeParser("text/markdown")) {
    app.addContentTypeParser("text/markdown", { parseAs: "string" }, (_request, body, done) => {
      done(null, body);
    });
  }

  async function profile(user) {
    const users = await mailerUsers({ usersPath, defaultUser });
    return users.find((candidate) => candidate.user === user) ?? {
      user, name: user, role: "",
    };
  }

  function bridgeFor(workspace, user, session, model) {
    if (suppliedBridge) return suppliedBridge;
    const key = `${workspace.id}\0${user}\0${session}\0${model}`;
    let bridge = bridges.get(key);
    if (!bridge) {
      bridge = createMailAgentBridge({
        ...bridgeOptions,
        user, session, model, exec, fileSystem, sleep, claudeBin, spawnWaitMs,
        logger: app.log,
      });
      bridges.set(key, bridge);
    }
    return bridge;
  }

  app.post("/mailagent", async (request, reply) => {
    const user = authenticatedMailerUser(request, defaultUser);
    const workspace = resolveWorkspace(request);
    const { message, threadId } = chatPayload(request.body);
    const { model } = await readMailAgentConfig(workspace, user, { fileSystem });
    if (model === "gpt-5.6-sol") {
      return reply.code(409).send({ error: "chat bu modelde yok" });
    }
    const userProfile = await profile(user);
    const session = mailAgentSession(workspace, userProfile.name, user);

    startSse(reply);
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
      const stream = await bridgeFor(workspace, user, session, model)(message, {
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
  app.get("/calibration/brief/:personId", async (request) => {
    authenticatedMailerUser(request, defaultUser);
    const workspace = resolveWorkspace(request);
    const person = workspace.index.entities.get(request.params.personId);
    if (!person || person.meta.type !== "person" || !hasMail(person)) {
      fail(404, "Mail adresi olan kişi bulunamadı");
    }
    return buildBrief(person, workspace.index, await loadSignals(workspace));
  });
  app.get("/calibration/skills", async (request) => {
    const user = authenticatedMailerUser(request, defaultUser);
    return listUserSkills(resolveWorkspace(request), user, { fileSystem });
  });
  app.put("/calibration/skills/:name", async (request) => {
    const user = authenticatedMailerUser(request, defaultUser);
    const content = typeof request.body === "string" ? request.body : request.body?.content;
    return writeUserSkill(
      resolveWorkspace(request), user, request.params.name, content, { fileSystem },
    );
  });
  app.delete("/calibration/skills/:name", async (request) => {
    const user = authenticatedMailerUser(request, defaultUser);
    return deleteUserSkill(
      resolveWorkspace(request), user, request.params.name, { fileSystem },
    );
  });
  app.get("/mailagent/config", async (request) => {
    const user = authenticatedMailerUser(request, defaultUser);
    return readMailAgentConfig(resolveWorkspace(request), user, { fileSystem });
  });
  app.put("/mailagent/config", async (request) => {
    const user = authenticatedMailerUser(request, defaultUser);
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
      fail(400, "JSON gövdesi nesne olmalı");
    }
    const workspace = resolveWorkspace(request);
    const previous = await readMailAgentConfig(workspace, user, { fileSystem });
    const written = await writeMailAgentConfig(workspace, user, request.body.model, { fileSystem });
    if (written.model !== previous.model) {
      const userProfile = await profile(user);
      const session = mailAgentSession(workspace, userProfile.name, user);
      await exec("tmux", ["kill-session", "-t", `=${session}`]).catch(() => {});
      const prefix = `${workspace.id}\0${user}\0`;
      for (const key of bridges.keys()) {
        if (key.startsWith(prefix)) bridges.delete(key);
      }
    }
    return written;
  });
  app.post("/calibration/draft", async (request, reply) => {
    const user = authenticatedMailerUser(request, defaultUser);
    const workspace = resolveWorkspace(request);
    const { personId, feedback } = calibrationDraftPayload(request.body);
    const person = workspace.index.entities.get(personId);
    if (!person || person.meta.type !== "person" || !hasMail(person)) {
      fail(404, "Mail adresi olan kişi bulunamadı");
    }
    const { model } = await readMailAgentConfig(workspace, user, { fileSystem });
    const abortController = new AbortController();
    let clientClosed = false;
    startSse(reply);
    reply.raw.once("close", () => {
      clientClosed = !reply.raw.writableEnded;
      if (clientClosed) abortController.abort();
    });
    let phase = "context";
    const t0 = performance.now();
    const marks = {};
    const mark = (key) => { marks[key] = Math.round(performance.now() - t0); };
    let firstToken = false;

    // Persist the feedback into the voice file — but do NOT let it gate the
    // draft. The draft prompt below already carries this feedback as red-notes,
    // so the mail can stream immediately while the voice update (a slower whole-
    // file rewrite that only benefits FUTURE drafts) runs in parallel.
    const runVoiceUpdate = async (voice) => {
      const prompt = gptFeedbackPrompt(feedback, voice);
      if (model === "gpt-5.6-sol") {
        const generated = generatedResult(await runCodex(prompt, {
          model, workspace, agent: contextAgent, user,
          kind: "chat", recordUsage: false, includeUsage: true,
        }));
        await writeCalibration(workspace, user, parseVoiceUpdate(generated.text), { now });
        await appendUsage(workspace, {
          ts: now().toISOString(), user, agent: "codex", kind: "chat",
          chars: prompt.length + generated.text.length,
          ...(generated.usage ?? estimatedUsage(prompt.length, generated.text.length)),
        }, { fileSystem }).catch((error) =>
          app.log.warn({ err: error }, "Codex feedback usage yazılamadı"));
      } else {
        let output = "";
        let usage = null;
        for await (const event of runClaudeDraft(prompt, {
          signal: abortController.signal, workspace, model, bin: claudeBin,
        })) {
          if (event?.usage) usage = event.usage;
          const delta = typeof event === "string" ? event : event?.delta;
          if (typeof delta === "string") output += delta;
        }
        await writeCalibration(workspace, user, parseVoiceUpdate(output), { now });
        await appendUsage(workspace, {
          ts: now().toISOString(), user, agent: "claude", kind: "chat",
          chars_in: prompt.length, chars_out: output.length,
          ...(usage ?? {}),
        }, { fileSystem });
      }
    };

    try {
      let voiceUpdate = null;
      if (feedback) {
        mark("feedback_start");
        const voice = await readCalibrationSource(workspace, user);
        voiceUpdate = runVoiceUpdate(voice).then(
          () => mark("feedback_end"),
          (error) => app.log.warn({ err: error }, "Feedback voice güncellemesi başarısız"),
        );
      }

      phase = "context";
      await sendEvent(reply, { phase });
      mark("context_start");
      // Deterministic context (<100ms, no LLM) built from the same brief the
      // Studio card shows — so what the user sees, the writer knows. This
      // replaces the ~15s luna call on every draft AND every rewrite.
      const context = briefContextText(
        buildBrief(person, workspace.index, await loadSignals(workspace)),
      );
      mark("context_end");
      const [skills, userSkills, calibration] = await Promise.all([
        readMailSkills(STUDIO_SKILLS),
        readUserSkillsPrompt(workspace, user, { fileSystem }),
        readCalibrationSource(workspace, user),
      ]);
      const prompt = calibrationDraftPrompt(context, skills, userSkills, calibration, feedback);
      mark("skills_end");
      phase = "writing";
      await sendEvent(reply, { phase });
      mark("writing_start");
      let output = "";
      if (model === "gpt-5.6-sol") {
        const generated = generatedResult(await runCodex(prompt, {
          model,
          workspace,
          agent: contextAgent,
          user,
          kind: "draft",
          recordUsage: false,
          includeUsage: true,
        }));
        output = generated.text;
        mark("first_token");
        if (output) await sendEvent(reply, { delta: output });
        await appendUsage(workspace, {
          ts: now().toISOString(), user, agent: "codex", kind: "draft",
          chars: prompt.length + output.length,
          ...(generated.usage ?? estimatedUsage(prompt.length, output.length)),
        }, { fileSystem }).catch((error) =>
          app.log.warn({ err: error }, "Codex Studio usage yazılamadı"));
      } else {
        let usage = null;
        const stream = runClaudeDraft(prompt, {
          signal: abortController.signal, workspace, model, bin: claudeBin,
        });
        for await (const event of stream) {
          if (event?.usage) usage = event.usage;
          const delta = typeof event === "string" ? event : event?.delta;
          if (typeof delta !== "string" || !delta) continue;
          if (!firstToken) { firstToken = true; mark("first_token"); }
          output += delta;
          if (!await sendEvent(reply, { delta })) break;
        }
        await appendUsage(workspace, {
          ts: now().toISOString(), user, agent: "claude", kind: "draft",
          chars: prompt.length + output.length,
          ...(usage ?? estimatedUsage(prompt.length, output.length)),
        }, { fileSystem }).catch((error) =>
          app.log.warn({ err: error }, "Claude Studio usage yazılamadı"));
      }
      mark("writing_end");
      // The mail is on screen; now settle the parallel voice update (usually
      // already done) so the client's post-done refetch sees the new voice.
      if (voiceUpdate) {
        phase = "voice";
        await sendEvent(reply, { phase });
        await voiceUpdate;
      }
      const draft = parseCalibrationDraft(output, {
        fallbackSubject: person.meta.name ?? person.id,
      });
      await recordCalibrationDraft(workspace, user, {
        ts: now().toISOString(), person_id: person.id, draft,
      }, { feedback, fileSystem });
      mark("done");
      app.log.info({
        calibDraft: true, model, feedback: Boolean(feedback), person: personId, marks,
      }, "calibration draft timing");
      if (!clientClosed) await sendEvent(reply, { done: true, draft });
    } catch (error) {
      if (!clientClosed) {
        await sendEvent(reply, { error: publicError(error), phase });
      }
    } finally {
      if (!clientClosed) reply.raw.end();
    }
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
