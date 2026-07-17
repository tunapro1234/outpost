import { mailQueue } from "./service.mjs";
import { approveMailDraft, listMailDrafts, rejectMailDraft } from "./drafts.mjs";

function decisionUser(request, defaultUser) {
  const header = request.headers["x-remote-user"];
  if (typeof header === "string" && header.trim()) return header.trim();
  if (typeof defaultUser === "string" && defaultUser.trim()) return defaultUser.trim();
  return "unknown";
}

export async function mailerRoutes(app, { resolveWorkspace, defaultUser }) {
  app.get("/mailqueue", async (request) => mailQueue(resolveWorkspace(request)));
  app.get("/maildrafts", async (request) => listMailDrafts(resolveWorkspace(request)));
  app.post("/maildrafts/:id/approve", async (request) =>
    approveMailDraft(resolveWorkspace(request), request.params.id, request.body));
  app.post("/maildrafts/:id/reject", async (request) =>
    rejectMailDraft(resolveWorkspace(request), request.params.id, request.body ?? {}, {
      user: decisionUser(request, defaultUser),
    }));
}
