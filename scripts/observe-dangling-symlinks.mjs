#!/usr/bin/env node
import { observeDanglingSymlinks } from "../src/observe-dangling-symlinks.mjs";

// Default excludes are ".git" only — deliberately NOT "node_modules": a
// dangling symlink inside node_modules is exactly the failure class that
// broke four packages' test suites silently, so it must not be excluded by
// default. Pass --exclude to scope a run further, or --no-default-excludes
// to drop even the ".git" default.
const DEFAULT_EXCLUDES = [".git"];

function usage() {
  console.error("usage: observe-dangling-symlinks --root <path> [--exclude <segment>]... [--no-default-excludes] [--strict]");
  process.exit(2);
}

const args = process.argv.slice(2);
let root = null;
let useDefaultExcludes = true;
let strict = false;
const excludes = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--root") root = args[(index += 1)];
  else if (arg === "--exclude") excludes.push(args[(index += 1)]);
  else if (arg === "--no-default-excludes") useDefaultExcludes = false;
  else if (arg === "--strict") strict = true;
  else usage();
}
if (!root) usage();
if (useDefaultExcludes) excludes.push(...DEFAULT_EXCLUDES);

const observation = await observeDanglingSymlinks({ root, excludes });

for (const entry of observation.dangling) {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

process.exit(strict && observation.dangling.length > 0 ? 1 : 0);
