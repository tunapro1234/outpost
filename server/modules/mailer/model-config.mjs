import { promises as fs } from "node:fs";
import path from "node:path";

export const DEFAULT_MAIL_AGENT_MODEL = "claude-opus-4-8";
export const MAIL_AGENT_MODELS = new Set([
  DEFAULT_MAIL_AGENT_MODEL,
  "claude-sonnet-5",
  "gpt-5.6-sol",
]);

function configPath(workspace, user) {
  return path.join(workspace.directory, "mailagent", user, "config.json");
}

function validateModel(model) {
  if (!MAIL_AGENT_MODELS.has(model)) {
    const error = new Error("Geçersiz mail agent modeli");
    error.statusCode = 400;
    throw error;
  }
  return model;
}

export async function readMailAgentConfig(workspace, user, { fileSystem = fs } = {}) {
  try {
    const parsed = JSON.parse(await fileSystem.readFile(configPath(workspace, user), "utf8"));
    return { model: validateModel(parsed?.model) };
  } catch (error) {
    if (error.code === "ENOENT") return { model: DEFAULT_MAIL_AGENT_MODEL };
    if (error instanceof SyntaxError) {
      throw new Error(`Mail agent config geçersiz JSON: ${error.message}`);
    }
    throw error;
  }
}

export async function writeMailAgentConfig(workspace, user, model, {
  fileSystem = fs,
} = {}) {
  const value = validateModel(model);
  const filePath = configPath(workspace, user);
  const directory = path.dirname(filePath);
  const temporary = path.join(directory, `.config-${process.pid}-${Date.now()}.tmp`);
  await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 });
  await fileSystem.chmod(directory, 0o700);
  try {
    await fileSystem.writeFile(temporary, `${JSON.stringify({ model: value }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await fileSystem.rename(temporary, filePath);
  } finally {
    await fileSystem.unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return { model: value };
}
