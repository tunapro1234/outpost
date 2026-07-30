export async function fleetRoutes(app, { resolveWorkspace, service }) {
  app.get("/fleet", async (request) => {
    resolveWorkspace(request);
    return service.load();
  });
}
