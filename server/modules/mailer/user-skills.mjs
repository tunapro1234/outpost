import { promises as fs } from "node:fs";
import path from "node:path";

export const USER_SKILL_NAME = /^[a-z0-9-]{1,40}\.md$/;
export const MAX_USER_SKILL_BYTES = 64 * 1024;
export const MAX_USER_SKILLS = 12;

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function validateName(name) {
  if (typeof name !== "string" || !USER_SKILL_NAME.test(name)) {
    fail(400, "Skill adı [a-z0-9-]{1,40}.md biçiminde olmalı");
  }
  return name;
}

function skillsDirectory(workspace, user) {
  return path.join(workspace.directory, "mails", "calibration", "skills", user);
}

async function skillNames(workspace, user, fileSystem) {
  try {
    const entries = await fileSystem.readdir(skillsDirectory(workspace, user), {
      withFileTypes: true,
    });
    return entries.filter((entry) => entry.isFile() && USER_SKILL_NAME.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, "en"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function listUserSkills(workspace, user, { fileSystem = fs } = {}) {
  const directory = skillsDirectory(workspace, user);
  const names = await skillNames(workspace, user, fileSystem);
  return Promise.all(names.map(async (name) => {
    const content = await fileSystem.readFile(path.join(directory, name), "utf8");
    return { name, size: Buffer.byteLength(content), content };
  }));
}

export async function writeUserSkill(workspace, user, name, content, {
  fileSystem = fs,
} = {}) {
  const safeName = validateName(name);
  if (typeof content !== "string") fail(400, "content metin olmalı");
  const size = Buffer.byteLength(content);
  if (size > MAX_USER_SKILL_BYTES) fail(413, "Skill en fazla 64KB olabilir");
  const directory = skillsDirectory(workspace, user);
  const names = await skillNames(workspace, user, fileSystem);
  if (!names.includes(safeName) && names.length >= MAX_USER_SKILLS) {
    fail(409, "En fazla 12 kullanıcı skill'i yüklenebilir");
  }
  const temporary = path.join(directory, `.skill-${process.pid}-${Date.now()}.tmp`);
  await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 });
  await fileSystem.chmod(directory, 0o700);
  try {
    await fileSystem.writeFile(temporary, content, {
      encoding: "utf8", mode: 0o600, flag: "wx",
    });
    await fileSystem.rename(temporary, path.join(directory, safeName));
  } finally {
    await fileSystem.unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return { name: safeName, size, content };
}

export async function deleteUserSkill(workspace, user, name, { fileSystem = fs } = {}) {
  const safeName = validateName(name);
  try {
    await fileSystem.unlink(path.join(skillsDirectory(workspace, user), safeName));
    return { deleted: true, name: safeName };
  } catch (error) {
    if (error.code === "ENOENT") fail(404, "Skill bulunamadı");
    throw error;
  }
}

export async function readUserSkillsPrompt(workspace, user, options = {}) {
  const skills = await listUserSkills(workspace, user, options);
  return skills.map(({ name, content }) => `## ${name}\n\n${content}`).join("\n\n");
}
