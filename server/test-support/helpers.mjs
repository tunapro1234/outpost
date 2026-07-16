import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export async function temporaryDirectory(prefix = "outpost-test-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function writeEntity(vault, directory, id, source) {
  const target = path.join(vault, directory, `${id}.md`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, source, "utf8");
  return target;
}
