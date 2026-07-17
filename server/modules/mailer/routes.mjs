import { mailQueue } from "./service.mjs";
import { readMailSettings, writeMailSettings } from "./settings.mjs";
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
  app.get("/mail-settings", async (request) => {
    authenticatedMailerUser(request, defaultUser);
    return readMailSettings(resolveWorkspace(request));
  });
  app.put("/mail-settings", async (request) => {
    await ownerUser(request, "mail ayarları yalnız owner");
    return writeMailSettings(resolveWorkspace(request), request.body ?? {});
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
