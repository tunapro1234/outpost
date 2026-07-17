import { readDashboard, writeDashboard } from "./service.mjs";

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

export async function dashboardRoutes(app, {
  resolveWorkspace,
  defaultUser = process.env.OUTPOST_DEFAULT_USER,
  fileSystem,
}) {
  app.get("/dashboard", async (request) => {
    const username = authenticatedUser(request, defaultUser);
    const workspace = resolveWorkspace(request);
    return readDashboard(workspace, username, { fileSystem });
  });

  app.put("/dashboard", async (request) => {
    const username = authenticatedUser(request, defaultUser);
    const workspace = resolveWorkspace(request);
    return writeDashboard(workspace, username, request.body, { fileSystem });
  });
}
