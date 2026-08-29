import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"),
) as { version: string };

export const DAEMON_VERSION = pkg.version;

function readGitBuild(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "local";
  }
}

export const DAEMON_BUILD = readGitBuild();
