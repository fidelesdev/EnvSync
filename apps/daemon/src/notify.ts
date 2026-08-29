import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function notifyDesktop(title: string, body: string): Promise<void> {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return;
  }

  try {
    await execFileAsync("notify-send", ["-a", "EnvSync", "-i", "dialog-information", title, body]);
  } catch {
    // notify-send optional
  }
}
