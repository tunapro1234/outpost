import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const writeLocks = new Map();

function sessionsPath(workspace, user) {
  return path.join(workspace.directory, "mails", "calibration", "sessions", `${user}.jsonl`);
}

async function readRecords(filePath, fileSystem) {
  try {
    const source = await fileSystem.readFile(filePath, "utf8");
    return source.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path.basename(filePath)}:${index + 1}: geçersiz JSON: ${error.message}`);
      }
    });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function withWriteLock(key, task) {
  const previous = writeLocks.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  writeLocks.set(key, current);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (writeLocks.get(key) === current) writeLocks.delete(key);
  }
}

export async function recordCalibrationDraft(workspace, user, record, {
  feedback,
  fileSystem = fs,
} = {}) {
  const filePath = sessionsPath(workspace, user);
  return withWriteLock(filePath, async () => {
    const records = await readRecords(filePath, fileSystem);
    if (feedback) {
      for (let index = records.length - 1; index >= 0; index -= 1) {
        if (records[index]?.person_id === record.person_id && records[index]?.draft) {
          records[index] = { ...records[index], feedback };
          break;
        }
      }
    }
    records.push(record);
    const directory = path.dirname(filePath);
    const temporary = path.join(
      directory,
      `.${user}-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}.tmp`,
    );
    await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await fileSystem.writeFile(
        temporary,
        `${records.map((item) => JSON.stringify(item)).join("\n")}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      await fileSystem.rename(temporary, filePath);
    } finally {
      await fileSystem.unlink(temporary).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    return record;
  });
}
