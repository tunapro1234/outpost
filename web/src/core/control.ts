export type ControlCommand =
  | { id: string; action: "navigate"; path: string }
  | { id: string; action: "open-entity"; ws?: string }
  | { id: string; action: "set-workspace"; ws: string }
  | { id: string; action: "set-theme"; theme: "dark" | "light" }
  | { id: string; action: "toast"; message: string };

const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function internalPath(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return false;
  }
  try {
    return new URL(value, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function parseControlCommand(value: unknown): ControlCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const command = value as Record<string, unknown>;
  if (!nonEmptyString(command.id) || typeof command.action !== "string") return null;

  switch (command.action) {
    case "navigate":
      return internalPath(command.path)
        ? { id: command.id, action: command.action, path: command.path }
        : null;
    case "open-entity":
      if (!nonEmptyString(command.id)) return null;
      if (command.ws !== undefined && !nonEmptyString(command.ws)) return null;
      return {
        action: command.action,
        id: command.id,
        ...(typeof command.ws === "string" ? { ws: command.ws } : {}),
      };
    case "set-workspace":
      return nonEmptyString(command.ws)
        ? { id: command.id, action: command.action, ws: command.ws }
        : null;
    case "set-theme":
      return command.theme === "dark" || command.theme === "light"
        ? { id: command.id, action: command.action, theme: command.theme }
        : null;
    case "toast":
      return nonEmptyString(command.message)
        ? { id: command.id, action: command.action, message: command.message }
        : null;
    default:
      return null;
  }
}

export function connectControl(onCommand: (command: ControlCommand) => void): () => void {
  let source: EventSource | null = null;
  let reconnectTimer: number | null = null;
  let reconnectMs = INITIAL_RECONNECT_MS;
  let stopped = false;

  const connect = () => {
    if (stopped) return;
    const current = new EventSource("/api/control/stream");
    source = current;

    current.onopen = () => {
      reconnectMs = INITIAL_RECONNECT_MS;
    };

    current.onmessage = (event) => {
      try {
        const command = parseControlCommand(JSON.parse(event.data));
        if (!command) return;
        onCommand(command);
      } catch {
        // Ignore malformed or non-allowlisted events.
      }
    };

    current.onerror = () => {
      if (source !== current || stopped) return;
      current.close();
      source = null;
      const delay = reconnectMs;
      reconnectMs = Math.min(reconnectMs * 2, MAX_RECONNECT_MS);
      reconnectTimer = window.setTimeout(connect, delay);
    };
  };

  connect();
  return () => {
    stopped = true;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    source?.close();
    source = null;
  };
}
