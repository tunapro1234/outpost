import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { VaultIndex } from "./vault.mjs";
import { resolveVaultAdapter } from "./vault-adapters.mjs";

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

function configuredVaultPath(directory, config) {
  const raw = config.vault_path ?? config.vaultPath;
  if (typeof raw !== "string" || !raw.trim()) return null;
  // Relative values stay inside the workspace; absolute values mount an
  // existing vault in place (no copy, single physical source of truth).
  return path.resolve(directory, raw.trim());
}

function trimmed(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(trimmed).filter(Boolean))];
}

// A workspace is a line of business; a network is one graph inside it. The
// relation is 1:N — Probot keeps its big research vault and the small warm
// vault side by side, and nothing is ever merged across the two (name
// similarity is not proof of identity).
export const DEFAULT_NETWORK_ID = "default";
const NETWORK_ID = /^[a-z0-9][a-z0-9_-]*$/i;

function networkRecord(directory, entry, { id, label, vaultPath } = {}) {
  const resolvedId = id ?? trimmed(entry.id);
  if (!resolvedId) throw new Error("network tanımında id zorunlu");
  if (!NETWORK_ID.test(resolvedId)) throw new Error(`geçersiz network id: ${resolvedId}`);
  return {
    id: resolvedId,
    label: trimmed(entry.label) ?? trimmed(entry.name) ?? label ?? resolvedId,
    vaultPath: path.resolve(
      vaultPath ?? configuredVaultPath(directory, entry) ?? path.join(directory, "vault"),
    ),
    adapter: resolveVaultAdapter(entry.adapter),
    // A vault Outpost does not own (someone else's live Obsidian vault) is
    // mounted read-only: every write path in the app refuses it.
    readOnly: entry.read_only === true || entry.readOnly === true,
    // UI-only default visibility. The index still loads and serves every
    // entity; the graph client decides whether to draw these slugs.
    hiddenNodes: stringList(entry.hidden_nodes),
    index: null,
  };
}

/**
 * Networks of a workspace. A config without a `networks:` list keeps the old
 * single-network shape (top-level `vault_path`/`adapter`/`read_only`, falling
 * back to `<workspace>/vault`), so existing workspaces are untouched.
 */
function workspaceNetworks(directory, config, vaultPath) {
  const declared = Array.isArray(config.networks)
    ? config.networks.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    : [];
  if (!declared.length || vaultPath) {
    return [
      networkRecord(directory, config, {
        id: DEFAULT_NETWORK_ID,
        label: trimmed(config.name) ?? "Network",
        vaultPath,
      }),
    ];
  }
  const networks = declared.map((entry) => networkRecord(directory, entry));
  const seen = new Set();
  for (const network of networks) {
    if (seen.has(network.id)) throw new Error(`network id tekrar ediyor: ${network.id}`);
    seen.add(network.id);
  }
  return networks;
}

function workspaceRecord(id, directory, config, vaultPath) {
  const mailLogPath = path.resolve(directory, "mails", "log.jsonl");
  const mailIngestedPath = path.resolve(directory, "mails", "ingested.jsonl");
  const mailsOutboxPath = path.resolve(directory, "mails", "outbox.jsonl");
  const networks = workspaceNetworks(directory, config, vaultPath);
  const declaredDefault = trimmed(config.default_network);
  const declaredUiDefault = trimmed(config.ui_default_network);
  const defaultNetworkId = networks.some((network) => network.id === declaredDefault)
    ? declaredDefault
    : networks[0].id;
  const workspace = {
    id,
    code: typeof config.code === "string" && config.code.trim() ? config.code.trim() : id,
    name: typeof config.name === "string" && config.name.trim() ? config.name.trim() : id,
    directory,
    config,
    networks,
    defaultNetworkId,
    // Deliberately separate from defaultNetworkId: mailer/reach/DB and all
    // legacy workspace accessors must keep using the operational default.
    uiDefaultNetworkId: networks.some((network) => network.id === declaredUiDefault)
      ? declaredUiDefault
      : defaultNetworkId,
    mailLogPath,
    mailIngestedPath,
    mailsOutboxPath,
    mailsPath: mailLogPath,
  };

  // `index`/`vaultPath`/`adapter`/`readOnly` keep working as before: they are
  // the workspace's DEFAULT network. Everything that never learned about
  // networks (mailer, gather, reach…) therefore stays on the same graph.
  const active = () =>
    workspace.networks.find((network) => network.id === workspace.defaultNetworkId)
    ?? workspace.networks[0];
  Object.defineProperties(workspace, {
    defaultNetwork: { get: active, enumerable: false },
    index: { get: () => active().index, set: (value) => { active().index = value; }, enumerable: true },
    vaultPath: {
      get: () => active().vaultPath,
      set: (value) => { active().vaultPath = path.resolve(value); },
      enumerable: true,
    },
    adapter: { get: () => active().adapter, enumerable: true },
    readOnly: { get: () => active().readOnly, enumerable: true },
    getNetwork: {
      value: (networkId) =>
        workspace.networks.find((network) => network.id === networkId) ?? null,
      enumerable: false,
    },
    listNetworks: {
      value: () => workspace.networks.map((network) => ({
        id: network.id,
        label: network.label,
        read_only: network.readOnly,
        adapter: network.adapter.name,
        entities: network.index?.entities.size ?? 0,
        default: network.id === workspace.defaultNetworkId,
        ui_default: network.id === workspace.uiDefaultNetworkId,
        hidden_nodes: [...network.hiddenNodes],
      })),
      enumerable: false,
    },
  });
  return workspace;
}

/**
 * A workspace as seen through ONE of its networks: same mail/db/directory
 * plumbing, different graph. The default network returns the workspace itself
 * so per-workspace caches (`__db`) keep a single identity.
 */
export function workspaceNetworkView(workspace, network) {
  if (!network || network.id === workspace.defaultNetworkId) return workspace;
  return Object.create(workspace, {
    network: { value: network, enumerable: false },
    networkId: { value: network.id, enumerable: true },
    index: { get: () => network.index, enumerable: true },
    vaultPath: { get: () => network.vaultPath, enumerable: true },
    adapter: { get: () => network.adapter, enumerable: true },
    readOnly: { get: () => network.readOnly, enumerable: true },
    // The SQLite handle belongs to the workspace, not to a network.
    __db: {
      get: () => workspace.__db,
      set: (value) => { workspace.__db = value; },
      enumerable: false,
    },
  });
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
      for (const network of workspace.networks) {
        network.index = await new VaultIndex(network.vaultPath, {
          adapter: network.adapter,
          readOnly: network.readOnly,
        }).load();
        if (watch) await network.index.startWatching();
      }
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
      [...this.workspaces.values()].flatMap((workspace) =>
        workspace.networks.map((network) => network.index?.close())),
    );
  }
}
