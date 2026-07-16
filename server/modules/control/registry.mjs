const HEARTBEAT_INTERVAL_MS = 25_000;

function writable(stream) {
  return !stream.destroyed && !stream.writableEnded;
}

export class ControlRegistry {
  constructor({ heartbeatMs = HEARTBEAT_INTERVAL_MS } = {}) {
    this.sessions = new Map();
    this.heartbeat = heartbeatMs > 0
      ? setInterval(() => this.#heartbeat(), heartbeatMs)
      : null;
    this.heartbeat?.unref?.();
  }

  add(username, stream) {
    let sessions = this.sessions.get(username);
    if (!sessions) {
      sessions = new Set();
      this.sessions.set(username, sessions);
    }
    sessions.add(stream);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      sessions.delete(stream);
      if (sessions.size === 0) this.sessions.delete(username);
    };
  }

  count(username) {
    return this.sessions.get(username)?.size ?? 0;
  }

  deliver(username, command) {
    const sessions = this.sessions.get(username);
    if (!sessions) return 0;

    const event = `data: ${JSON.stringify(command)}\n\n`;
    let delivered = 0;
    for (const stream of [...sessions]) {
      if (!writable(stream)) {
        sessions.delete(stream);
        continue;
      }
      try {
        stream.write(event);
        delivered += 1;
      } catch {
        sessions.delete(stream);
      }
    }
    if (sessions.size === 0) this.sessions.delete(username);
    return delivered;
  }

  close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const sessions of this.sessions.values()) {
      for (const stream of sessions) {
        if (!writable(stream)) continue;
        try {
          stream.end();
        } catch {
          // The peer may have closed between the writable check and end().
        }
      }
    }
    this.sessions.clear();
  }

  #heartbeat() {
    for (const [username, sessions] of this.sessions) {
      for (const stream of [...sessions]) {
        if (!writable(stream)) {
          sessions.delete(stream);
          continue;
        }
        try {
          stream.write(": ping\n\n");
        } catch {
          sessions.delete(stream);
        }
      }
      if (sessions.size === 0) this.sessions.delete(username);
    }
  }
}
