import { promises as fs } from "node:fs";
import path from "node:path";

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

export async function recordCalibrationDraft(workspace, user, record, {
  feedback,
  fileSystem = fs,
} = {}) {
  const filePath = sessionsPath(workspace, user);
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
  await fileSystem.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fileSystem.writeFile(
    filePath,
    `${records.map((item) => JSON.stringify(item)).join("\n")}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return record;
}
