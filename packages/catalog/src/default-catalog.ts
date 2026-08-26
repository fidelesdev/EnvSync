import type { Catalog } from "./types.js";

export const DEFAULT_CATALOG: Catalog = {
  groups: [
    { id: "cli", label: "Programas CLI", icon: "terminal" },
    { id: "ui", label: "Programas UI", icon: "window" },
    { id: "dotfiles", label: "Dotfiles", icon: "file" },
    { id: "folders", label: "Pastas", icon: "folder" },
    { id: "env", label: "Variáveis de ambiente", icon: "key" },
  ],
  items: [
    {
      id: "ripgrep",
      label: "ripgrep",
      groupId: "cli",
      providers: [{ type: "package", manager: "pacman", name: "ripgrep" }],
    },
    {
      id: "fd",
      label: "fd",
      groupId: "cli",
      providers: [{ type: "package", manager: "pacman", name: "fd" }],
    },
    {
      id: "jq",
      label: "jq",
      groupId: "cli",
      providers: [{ type: "package", manager: "pacman", name: "jq" }],
    },
    {
      id: "chrome",
      label: "Google Chrome",
      groupId: "ui",
      providers: [
        { type: "package", manager: "aur", name: "google-chrome" },
        {
          type: "paths",
          paths: ["~/.config/google-chrome/Default/Preferences"],
          excludes: [
            "**/Cookies",
            "**/Login Data",
            "**/Cache/**",
            "**/Code Cache/**",
          ],
        },
      ],
    },
    {
      id: "vscode",
      label: "VS Code / Cursor configs",
      groupId: "ui",
      providers: [
        {
          type: "paths",
          paths: ["~/.config/Code/User", "~/.config/Cursor/User"],
          excludes: ["**/Cache/**", "**/CachedData/**"],
        },
      ],
    },
    {
      id: "bashrc",
      label: ".bashrc",
      groupId: "dotfiles",
      providers: [{ type: "paths", paths: ["~/.bashrc"] }],
    },
    {
      id: "gitconfig",
      label: ".gitconfig",
      groupId: "dotfiles",
      providers: [{ type: "paths", paths: ["~/.gitconfig"] }],
    },
    {
      id: "scripts-folder",
      label: "~/scripts",
      groupId: "folders",
      providers: [{ type: "paths", paths: ["~/scripts"] }],
    },
    {
      id: "path-env",
      label: "PATH extras (gerenciado)",
      groupId: "env",
      providers: [{ type: "env", keys: ["PATH_EXTRA", "EDITOR", "BROWSER"] }],
    },
  ],
};
