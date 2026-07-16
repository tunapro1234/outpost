import { mailQueue } from "./service.mjs";
import { approveMailDraft, listMailDrafts, rejectMailDraft } from "./drafts.mjs";

export async function mailerRoutes(app, { resolveWorkspace }) {
  app.get("/mailqueue", async (request) => mailQueue(resolveWorkspace(request)));
  app.get("/maildrafts", async (request) => listMailDrafts(resolveWorkspace(request)));
  app.post("/maildrafts/:id/approve", async (request) =>
    approveMailDraft(resolveWorkspace(request), request.params.id, request.body));
  app.post("/maildrafts/:id/reject", async (request) =>
    rejectMailDraft(resolveWorkspace(request), request.params.id, request.body ?? {}));
}
