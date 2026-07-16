export async function gatherRoutes(app, { resolveWorkspace }) {
  app.all("/gather", async (request, reply) => {
    resolveWorkspace(request);
    return reply.code(501).send({ error: "Gather module not implemented" });
  });
}
