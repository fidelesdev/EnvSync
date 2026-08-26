import { aurPlugin, appimagePlugin, flatpakPlugin, pacmanPlugin } from "./pacman.js";
import { envPlugin } from "./env.js";
import { filesPlugin } from "./files.js";
import type { SyncPlugin } from "./types.js";

const plugins: SyncPlugin[] = [
  filesPlugin,
  envPlugin,
  pacmanPlugin,
  aurPlugin,
  flatpakPlugin,
  appimagePlugin,
];

export function getPlugin(id: string): SyncPlugin {
  const plugin = plugins.find((entry) => entry.id === id);
  if (!plugin) throw new Error(`Plugin desconhecido: ${id}`);
  return plugin;
}

export function listPlugins(): SyncPlugin[] {
  return [...plugins];
}
