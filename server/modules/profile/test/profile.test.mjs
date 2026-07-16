import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import yaml from "js-yaml";
import { createApp } from "../../../app.mjs";
import { temporaryDirectory } from "../../../test-support/helpers.mjs";

const run = promisify(execFile);
const EXAMPLE_VAULT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../example-vault",
);

async function fixtureApp(t, usersSource) {
  const directory = await temporaryDirectory("outpost-profile-");
  const usersPath = path.join(directory, "users.yaml");
  await fs.writeFile(usersPath, usersSource, "utf8");
  const app = await createApp({
    vaultPath: EXAMPLE_VAULT,
    usersPath,
    defaultUser: "tuna",
    watch: false,
  });
  t.after(() => app.close());
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { app, usersPath, directory };
}

test("GET /api/profile header kullanıcısını ve yapılandırılmış default kullanıcıyı döndürür", async (t) => {
  const { app } = await fixtureApp(t, `users:
  - username: tuna
    name: Tuna
    mail: tuna@example.com
    phone: ""
    role: owner
  - username: deniz
    name: Deniz
    mail: deniz@example.com
    phone: "123"
    role: member
`);

  const fallback = await app.inject({ url: "/api/profile" });
  assert.equal(fallback.statusCode, 200);
  assert.deepEqual(fallback.json(), {
    username: "tuna",
    name: "Tuna",
    mail: "tuna@example.com",
    phone: "",
    role: "owner",
  });

  const remote = await app.inject({
    url: "/api/profile",
    headers: { "x-remote-user": "deniz" },
  });
  assert.equal(remote.statusCode, 200);
  assert.equal(remote.json().username, "deniz");
});

test("header ve OUTPOST_DEFAULT_USER yoksa profil kimliksiz isteği 401 ile reddeder", async (t) => {
  const directory = await temporaryDirectory("outpost-profile-auth-");
  const usersPath = path.join(directory, "users.yaml");
  await fs.writeFile(usersPath, "users:\n  - username: tuna\n    name: Tuna\n", "utf8");
  const app = await createApp({
    vaultPath: EXAMPLE_VAULT,
    usersPath,
    defaultUser: "",
    watch: false,
  });
  t.after(() => app.close());
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const anonymous = await app.inject({ url: "/api/profile" });
  assert.equal(anonymous.statusCode, 401);
  assert.deepEqual(anonymous.json(), { error: "authentication required" });
  assert.equal((await app.inject({
    url: "/api/profile",
    headers: { "x-remote-user": "tuna" },
  })).statusCode, 200);
});

test("PATCH /api/profile izinli alanları users.yaml'a yazar ve diğer kullanıcıyı korur", async (t) => {
  const { app, usersPath } = await fixtureApp(t, `users:
  - username: tuna
    name: Tuna
    mail: old@example.com
    phone: ""
    role: owner
    extra: korunur
  - username: deniz
    name: Deniz
    role: member
`);

  const response = await app.inject({
    method: "PATCH",
    url: "/api/profile",
    payload: { name: "Yeni Tuna", mail: "new@example.com", phone: "555" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    username: "tuna",
    name: "Yeni Tuna",
    mail: "new@example.com",
    phone: "555",
    role: "owner",
  });

  const stored = yaml.load(await fs.readFile(usersPath, "utf8"));
  assert.equal(stored.users[0].extra, "korunur");
  assert.equal(stored.users[1].name, "Deniz");
});

test("eksik users.yaml default tuna profilini bellekte tutar ve dosya oluşturmaz", async (t) => {
  const directory = await temporaryDirectory("outpost-profile-missing-");
  const usersPath = path.join(directory, "users.yaml");
  const app = await createApp({
    vaultPath: EXAMPLE_VAULT,
    usersPath,
    defaultUser: "tuna",
    watch: false,
  });
  t.after(() => app.close());
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const response = await app.inject({ url: "/api/profile" });
  assert.deepEqual(response.json(), {
    username: "tuna",
    name: "Tuna",
    mail: "",
    phone: "",
    role: "owner",
  });
  await assert.rejects(fs.access(usersPath), { code: "ENOENT" });
});

test("profil ve şifre entegrasyonları ayarlanmamışsa anlaşılır 503 döner", async (t) => {
  const app = await createApp({ vaultPath: EXAMPLE_VAULT, defaultUser: "tuna", watch: false });
  t.after(() => app.close());

  const profile = await app.inject({ url: "/api/profile" });
  assert.equal(profile.statusCode, 503);
  assert.deepEqual(profile.json(), { error: "Profile is not configured" });

  const password = await app.inject({
    method: "POST",
    url: "/api/profile/password",
    payload: { current: "old-password", next: "new-password" },
  });
  assert.equal(password.statusCode, 503);
  assert.deepEqual(password.json(), { error: "Password change is not configured" });
});

test("POST /api/profile/password mevcut şifreyi doğrular ve günceller", async (t) => {
  try {
    await run("htpasswd", ["-nb", "probe", "probe-password"]);
  } catch {
    t.skip("htpasswd binary bulunamadı");
    return;
  }

  const fixture = await fixtureApp(t, `users:
  - username: tuna
    name: Tuna
    role: owner
`);
  const htpasswdPath = path.join(fixture.directory, ".htpasswd");
  await run("htpasswd", ["-cbB", htpasswdPath, "tuna", "old-password"]);
  await fs.chmod(htpasswdPath, 0o640);
  const modeBefore = (await fs.stat(htpasswdPath)).mode & 0o777;
  const app = await createApp({
    vaultPath: EXAMPLE_VAULT,
    usersPath: fixture.usersPath,
    htpasswdPath,
    defaultUser: "tuna",
    watch: false,
  });
  t.after(() => app.close());

  const wrong = await app.inject({
    method: "POST",
    url: "/api/profile/password",
    payload: { current: "wrong-password", next: "new-password" },
  });
  assert.equal(wrong.statusCode, 401);

  const short = await app.inject({
    method: "POST",
    url: "/api/profile/password",
    payload: { current: "old-password", next: "short" },
  });
  assert.equal(short.statusCode, 400);

  const changed = await app.inject({
    method: "POST",
    url: "/api/profile/password",
    payload: { current: "old-password", next: "new-password" },
  });
  assert.equal(changed.statusCode, 200);
  assert.deepEqual(changed.json(), { ok: true });
  assert.equal((await fs.stat(htpasswdPath)).mode & 0o777, modeBefore);
  await run("htpasswd", ["-bv", htpasswdPath, "tuna", "new-password"]);
  await assert.rejects(run("htpasswd", ["-bv", htpasswdPath, "tuna", "old-password"]));
});
