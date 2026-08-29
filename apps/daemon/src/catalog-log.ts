import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@envsync/core";

type LogLevel = "info" | "warn" | "error";

export function catalogLogPath(): string {
  return join(dataDir(), "catalog-survey.log");
}

export function catalogLog(
  level: LogLevel,
  message: string,
  detail?: Record<string, unknown>,
): void {
  const entry = {
    at: new Date().toISOString(),
    level,
    message,
    ...detail,
  };
  const line = `${JSON.stringify(entry)}\n`;

  try {
    const dir = dataDir();
    mkdirSync(dir, { recursive: true });
    appendFileSync(catalogLogPath(), line);
  } catch {
    // ignore log file errors
  }

  const prefix = `[envsync:catalog:${level}] ${message}`;
  if (level === "error") {
    console.error(prefix, detail ?? "");
  } else if (level === "warn") {
    console.warn(prefix, detail ?? "");
  } else {
    console.log(prefix, detail ?? "");
  }
}
