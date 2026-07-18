import { mailQueue } from "./service.mjs";
import { readMailSettings, writeMailSettings } from "./settings.mjs";
import { verifyMailbox } from "./mailprobe.mjs";
import { trackingRows } from "./tracking.mjs";
import { buildMailRecords, mailRecord, mailAnalytics } from "./maildb.mjs";
import { importMails } from "./import.mjs";
import { syncEntities } from "./store.mjs";
import { updateEntityMeta } from "../../lib/entity-meta.mjs";
import {
  approveMailDraft,
  listExclusions,
  listMailDrafts,
  overrideExclusion,
  rejectMailDraft,
} from "./drafts.mjs";
import {
  authenticatedMailerUser,
  isMailerOwner,
  requireMailerOwner,
} from "./auth.mjs";

export async function mailerRoutes(app, {
  resolveWorkspace,
  defaultUser,
  usersPath = process.env.OUTPOST_USERS,
}) {
  async function ownerUser(request, message) {
    const user = authenticatedMailerUser(request, defaultUser);
    requireMailerOwner(await isMailerOwner(user, { usersPath, defaultUser }), message);
    return user;
  }

  app.get("/mailqueue", async (request) => mailQueue(resolveWorkspace(request)));
  app.post("/mail/probe/:personId", async (request) => {
    await ownerUser(request, "probe yalnız owner");
    const workspace = resolveWorkspace(request);
    const person = workspace.index.entities.get(request.params.personId);
    if (!person || person.meta.type !== "person") {
      const error = new Error("kişi bulunamadı"); error.statusCode = 404; throw error;
    }
    const mail = person.meta.mail ?? (Array.isArray(person.meta.mails) ? person.meta.mails[0] : null);
    if (!mail || mail === "-") return { probe_state: "no_mail" };
    const result = await verifyMailbox(mail);
    await updateEntityMeta(workspace, person, {
      mail_probe: result.probe_state,
      mail_probe_at: result.at ?? new Date().toISOString(),
    });
    return result;
  });
  app.get("/mail-settings", async (request) => {
    authenticatedMailerUser(request, defaultUser);
    return readMailSettings(resolveWorkspace(request));
  });
  app.put("/mail-settings", async (request) => {
    await ownerUser(request, "mail ayarları yalnız owner");
    return writeMailSettings(resolveWorkspace(request), request.body ?? {});
  });
  app.get("/mailtracking", async (request) => {
    authenticatedMailerUser(request, defaultUser);
    return trackingRows(resolveWorkspace(request));
  });
  // Kanonik mail DB: içerik + track edilen her şey + üretim provenance'ı.
  app.get("/maildb", async (request) => {
    authenticatedMailerUser(request, defaultUser);
    return { mails: await buildMailRecords(resolveWorkspace(request)) };
  });
  app.get("/maildb/:id", async (request) => {
    authenticatedMailerUser(request, defaultUser);
    const record = await mailRecord(resolveWorkspace(request), request.params.id);
    if (!record) {
      const error = new Error("Mail kaydı bulunamadı"); error.statusCode = 404; throw error;
    }
    return record;
  });
  // Reply-rate kırılımları: modele/tona/skora/saate/followup'a göre optimizasyon.
  app.get("/mailanalytics", async (request) => {
    authenticatedMailerUser(request, defaultUser);
    return mailAnalytics(resolveWorkspace(request));
  });
  // Var olan / insan-yazımı mailleri içeri al (compec korpusu vb). Owner-only.
  // Gövde: { mails: [{to,subject,body,date,company,person,author,message_id}], author? }
  app.post("/mail/import", async (request) => {
    await ownerUser(request, "mail import yalnız owner");
    const workspace = resolveWorkspace(request);
    const body = request.body ?? {};
    // Entity eşleşmesi güncel olsun diye aynayı tazele (kişi/şirket bağlama için).
    try { syncEntities(workspace); } catch { /* aynasız da eşleşme in-memory index'ten çalışır */ }
    const result = await importMails(workspace, body.mails ?? body, {
      defaultAuthor: typeof body.author === "string" && body.author.trim() ? body.author.trim() : "human",
    });
    return result;
  });
  app.get("/maildrafts", async (request) => listMailDrafts(resolveWorkspace(request)));
  app.post("/maildrafts/:id/approve", async (request) => {
    await ownerUser(request);
    return approveMailDraft(resolveWorkspace(request), request.params.id, request.body);
  });
  app.post("/maildrafts/:id/reject", async (request) => {
    const user = authenticatedMailerUser(request, defaultUser);
    return rejectMailDraft(resolveWorkspace(request), request.params.id, request.body ?? {}, { user });
  });
  app.get("/exclusions", async (request) => listExclusions(resolveWorkspace(request)));
  app.delete("/exclusions/:companyId", async (request) => {
    const user = await ownerUser(request, "exclusion override yetkisi yalnız owner");
    return overrideExclusion(
      resolveWorkspace(request),
      request.params.companyId,
      request.body ?? {},
      { user },
    );
  });
}
