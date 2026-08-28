import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function pickFolderDialog(): Promise<string | null> {
  if (!process.env.DISPLAY) {
    return null;
  }

  const home = process.env.HOME ?? "/";

  const attempts: Array<[string, string[]]> = [
    ["zenity", ["--file-selection", "--directory", "--title=Selecionar pasta"]],
    ["kdialog", ["--getexistingdirectory", home, "--title", "Selecionar pasta"]],
    ["xdg-desktop-menu", []],
  ];

  for (const [command, args] of attempts.slice(0, 2)) {
    try {
      const { stdout } = await execFileAsync(command, args);
      const path = stdout.trim();
      if (path) return path;
    } catch {
      // try next helper
    }
  }

  return null;
}
