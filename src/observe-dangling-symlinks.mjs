import { readlink, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { walkPosixPaths } from "@red-cup-engineering/path-walking-service";

const OBSERVATION_TYPE = "DanglingSymlinkObservation";

// A PosixPathWalk records a symlink as its own path/kind entry but never
// stats or follows its target (see path-walking-service's walkPosixPaths):
// the walk is a listing, not a resolution. Whether a symlink's target
// resolves is exactly what this service adds on top, at report time: for
// every symlink entry the walk finds, follow-stat the target and report the
// ones that fail to resolve as dangling — the failure class that broke four
// packages' test suites silently before this existed. "target" is the raw
// readlink() value (what the symlink itself points to), not a resolved
// absolute path, since that is what is actionable to someone fixing it.
export async function observeDanglingSymlinks({ root, excludes = [] } = {}) {
  const walk = await walkPosixPaths({ root, excludes });

  const dangling = [];
  let symlinks = 0;
  for (const entry of walk.files) {
    if (entry.kind !== "symlink") continue;
    symlinks += 1;
    const absolutePath = resolve(walk.root, entry.path);
    const target = await readlink(absolutePath);
    try {
      await stat(absolutePath); // follows the link; never lstat here
    } catch {
      dangling.push({ path: entry.path, target, kind: "dangling" });
    }
  }

  return Object.freeze({
    type: OBSERVATION_TYPE,
    root: walk.root,
    dangling: Object.freeze(dangling.map((entry) => Object.freeze(entry))),
    symlinks,
    files: walk.files.length,
    directories: walk.directories,
    excluded: walk.excluded,
  });
}
