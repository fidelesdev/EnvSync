import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function readGitBuild(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "local";
  }
}

const pkg = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: {
    __ENVSYNC_UI_VERSION__: JSON.stringify(pkg.version),
    __ENVSYNC_UI_BUILD__: JSON.stringify(readGitBuild()),
  },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  base: "./",
});
