import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { VaultIndex } from "./vault.mjs";

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

function workspaceRecord(id, directory, config, vaultPath) {
  const mailLogPath = path.resolve(directory, "mails", "log.jsonl");
  return {
    id,
    name: typeof config.name === "string" && config.name.trim() ? config.name.trim() : id,
    directory,
    config,
    vaultPath: path.resolve(vaultPath ?? path.join(directory, "vault")),
    mailLogPath,
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
    workspacesPath = process.env.OUTPOST_WORKSPACES ?? path.resolve(process.cwd(), "workspaces"),
    vaultPath,
    envVaultPath,
    outpostVault = envVaultPath === undefined ? process.env.OUTPOST_VAULT : envVaultPath,
    defaultWorkspace,
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
