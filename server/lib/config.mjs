import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { VaultIndex } from "./vault.mjs";

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_EXAMPLE_VAULT = path.resolve(MODULE_DIRECTORY, "../../example-vault");
const DEFAULT_WORKSPACES = path.resolve(process.cwd(), "data/workspaces");

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function readYaml(filePath) {
  try {
    const value = yaml.load(await fs.readFile(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function directories(root) {
  try {
    return (await fs.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^[a-z0-9][a-z0-9_-]*$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, "en"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function seedDemoWorkspace(root, exampleVaultPath) {
  const directory = path.join(root, "demo");
  await fs.mkdir(root, { recursive: true });
  try {
    await fs.mkdir(directory);
  } catch (error) {
    if (error.code === "EEXIST") return null;
    throw error;
  }

  try {
    await fs.cp(exampleVaultPath, path.join(directory, "vault"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await fs.writeFile(path.join(directory, "config.yaml"), "name: Demo\n", "utf8");
    return workspaceRecord("demo", directory, { name: "Demo" });
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function workspaceRecord(id, directory, config, vaultPath) {
  const mailLogPath = path.resolve(directory, "mails", "log.jsonl");
  const mailIngestedPath = path.resolve(directory, "mails", "ingested.jsonl");
  const mailsOutboxPath = path.resolve(directory, "mails", "outbox.jsonl");
  return {
    id,
    name: typeof config.name === "string" && config.name.trim() ? config.name.trim() : id,
    directory,
    config,
    vaultPath: path.resolve(vaultPath ?? path.join(directory, "vault")),
    mailLogPath,
    mailIngestedPath,
    mailsOutboxPath,
    mailsPath: mailLogPath,
    index: null,
  };
}

export class WorkspaceRegistry {
  constructor({ root, workspaces, defaultId }) {
    this.root = path.resolve(root);
    this.workspaces = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
    this.defaultId = defaultId;
  }

  static async load({
    workspacesPath = process.env.OUTPOST_WORKSPACES ?? DEFAULT_WORKSPACES,
    vaultPath,
    envVaultPath,
    outpostVault = envVaultPath === undefined ? process.env.OUTPOST_VAULT : envVaultPath,
    defaultWorkspace,
    exampleVaultPath = DEFAULT_EXAMPLE_VAULT,
    onSeed,
    watch = true,
  } = {}) {
    const root = path.resolve(workspacesPath);
    let workspaces;
    let defaultId;

    if (vaultPath) {
      const resolvedVault = path.resolve(vaultPath);
      const directory = resolvedVault;
      workspaces = [workspaceRecord("default", directory, { name: "Default" }, resolvedVault)];
      defaultId = "default";
    } else {
      const rootConfig = await readYaml(path.join(root, "config.yaml"));
      workspaces = [];
      for (const id of await directories(root)) {
        const directory = path.join(root, id);
        const config = await readYaml(path.join(directory, "config.yaml"));
        workspaces.push(workspaceRecord(id, directory, config));
      }

      const configuredDefault =
        defaultWorkspace ??
        rootConfig.default_workspace ??
        workspaces.map((workspace) => workspace.config.default_workspace).find(Boolean);
      defaultId = workspaces.some((workspace) => workspace.id === configuredDefault)
        ? configuredDefault
        : workspaces[0]?.id;

      if (!workspaces.length && outpostVault) {
        const directory = path.join(root, "probot");
        await fs.mkdir(path.join(directory, "mails"), { recursive: true });
        await fs.writeFile(
          path.join(directory, "config.yaml"),
          "name: Probot\n",
          { encoding: "utf8", flag: "wx" },
        ).catch((error) => {
          if (error.code !== "EEXIST") throw error;
        });
        workspaces.push(
          workspaceRecord("probot", directory, { name: "Probot" }, path.resolve(outpostVault)),
        );
        defaultId = "probot";
      } else if (!workspaces.length) {
        const seeded = await seedDemoWorkspace(root, path.resolve(exampleVaultPath));
        if (seeded) {
          workspaces.push(seeded);
          defaultId = seeded.id;
          onSeed?.({
            id: seeded.id,
            directory: seeded.directory,
            source: path.resolve(exampleVaultPath),
          });
        } else {
          for (const id of await directories(root)) {
            const directory = path.join(root, id);
            const config = await readYaml(path.join(directory, "config.yaml"));
            workspaces.push(workspaceRecord(id, directory, config));
          }
          defaultId = workspaces[0]?.id;
        }
      } else if (outpostVault && defaultId && await exists(path.resolve(outpostVault))) {
        const workspace = workspaces.find((candidate) => candidate.id === defaultId);
        workspace.vaultPath = path.resolve(outpostVault);
      }
    }

    const registry = new WorkspaceRegistry({ root, workspaces, defaultId });
    await registry.open({ watch });
    return registry;
  }

  static async fromVault(vaultPath, { watch = true } = {}) {
    return WorkspaceRegistry.load({ vaultPath, watch });
  }

  async open({ watch }) {
    for (const workspace of this.workspaces.values()) {
      workspace.index = await new VaultIndex(workspace.vaultPath).load();
      if (watch) await workspace.index.startWatching();
    }
  }

  get(id) {
    return this.workspaces.get(id);
  }

  getDefault() {
    return this.defaultId ? this.workspaces.get(this.defaultId) : undefined;
  }

  get defaultWorkspace() {
    return this.getDefault();
  }

  list() {
    return [...this.workspaces.values()].map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      entities: workspace.index.entities.size,
      default: workspace.id === this.defaultId,
    }));
  }

  async close() {
    await Promise.all(
      [...this.workspaces.values()].map((workspace) => workspace.index.close()),
    );
  }
}
