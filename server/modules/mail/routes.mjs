export async function mailRoutes(app, { resolveWorkspace, ingestor }) {
  app.post("/mail/refresh", async (request) => ingestor.refresh(resolveWorkspace(request)));
}
