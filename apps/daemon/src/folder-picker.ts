import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function resolveDisplay(): string | undefined {
  if (process.env.DISPLAY) return process.env.DISPLAY;
  const uid = process.getuid?.();
  if (uid === undefined) return undefined;
  return `:0`;
}

export async function pickFolderDialog(): Promise<string | null> {
  const display = resolveDisplay();
  if (!display) {
    return null;
  }

  const home = process.env.HOME ?? "/";
  const env = { ...process.env, DISPLAY: display };

  const attempts: Array<[string, string[]]> = [
    ["kdialog", ["--getexistingdirectory", home, "--title", "Selecionar pasta"]],
    ["zenity", ["--file-selection", "--directory", "--title=Selecionar pasta"]],
  ];

  for (const [command, args] of attempts) {
    try {
      const { stdout } = await execFileAsync(command, args, { env });
      const path = stdout.trim();
      if (path) return path;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") continue;
      return null;
    }
  }

  return null;
}
