import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { observeDanglingSymlinks } from "../src/observe-dangling-symlinks.mjs";

const execFileAsync = promisify(execFile);

async function buildFixture() {
  const root = await mkdtemp(join(tmpdir(), "symlink-observation-"));
  await mkdir(join(root, "node_modules", "some-pkg"), { recursive: true });
  await mkdir(join(root, ".git"), { recursive: true });
  await writeFile(join(root, "target.txt"), "real file\n");

  // 1. symlink to an existing file — not dangling.
  await symlink("target.txt", join(root, "good-link"));
  // 2. symlink to a nonexistent path — dangling.
  await symlink("nope-file.txt", join(root, "dangling-file-link"));
  // 5. symlink to a nonexistent directory — also dangling.
  await symlink("nope-dir", join(root, "dangling-dir-link"));
  // 3. dangling symlink inside node_modules — must be reported since
  //    node_modules is not excluded by default (that is the whole point).
  await symlink("../missing-target", join(root, "node_modules", "some-pkg", "broken-link"));
  // 4. dangling symlink inside .git — excluded when ".git" is passed.
  await symlink("missing-ref", join(root, ".git", "dangling-git-link"));

  return root;
}

test("reports dangling symlinks, including inside node_modules, with .git excluded", async () => {
  const root = await buildFixture();
  try {
    const observation = await observeDanglingSymlinks({ root, excludes: [".git"] });
    assert.equal(observation.type, "DanglingSymlinkObservation");
    assert.equal(observation.root, root);

    const paths = observation.dangling.map((entry) => entry.path).sort();
    assert.deepEqual(paths, [
      "dangling-dir-link",
      "dangling-file-link",
      "node_modules/some-pkg/broken-link",
    ]);
    assert.equal(paths.some((path) => path.includes(".git")), false, ".git entries must be excluded when passed");
    assert.equal(paths.includes("good-link"), false, "a symlink to an existing file must not be reported");

    for (const entry of observation.dangling) {
      assert.equal(entry.kind, "dangling");
      assert.equal(typeof entry.target, "string");
    }
    const fileLink = observation.dangling.find((entry) => entry.path === "dangling-file-link");
    assert.equal(fileLink.target, "nope-file.txt", "target is the raw readlink value, not a resolved absolute path");

    assert.equal(observation.symlinks, 4, "4 of the 5 symlinks are walked; the .git one is excluded before counting");
    assert.ok(Object.isFrozen(observation));
    assert.ok(Object.isFrozen(observation.dangling));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("with no excludes, the dangling symlink inside .git is reported too", async () => {
  const root = await buildFixture();
  try {
    const observation = await observeDanglingSymlinks({ root });
    const paths = observation.dangling.map((entry) => entry.path);
    assert.ok(paths.includes(".git/dangling-git-link"));
    assert.equal(observation.symlinks, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI: default excludes are .git only, node_modules is walked, output is NDJSON, --strict exits 1", async () => {
  const root = await buildFixture();
  try {
    const binPath = join(import.meta.dirname, "..", "scripts", "observe-dangling-symlinks.mjs");
    let result;
    try {
      result = await execFileAsync("node", [binPath, "--root", root, "--strict"]);
      assert.fail("expected --strict to exit non-zero when findings > 0");
    } catch (error) {
      assert.equal(error.code, 1, "exit code 1 when findings > 0 under --strict");
      result = error;
    }
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    const entries = lines.map((line) => JSON.parse(line));
    const paths = entries.map((entry) => entry.path).sort();
    assert.deepEqual(paths, [
      "dangling-dir-link",
      "dangling-file-link",
      "node_modules/some-pkg/broken-link",
    ]);
    assert.equal(paths.some((path) => path.includes(".git")), false, "default excludes must drop .git");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("root is required, propagated from path-walking-service", async () => {
  await assert.rejects(() => observeDanglingSymlinks({}), TypeError);
});
