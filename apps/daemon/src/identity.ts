import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import selfsigned from "selfsigned";

export type DeviceIdentity = {
  fingerprint: string;
  certPem: string;
  keyPem: string;
};

export function certFingerprint(certPem: string): string {
  const body = certPem
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s+/g, "");
  return createHash("sha256").update(Buffer.from(body, "base64")).digest("hex");
}

export function loadOrCreateIdentity(certsDir: string): DeviceIdentity {
  mkdirSync(certsDir, { recursive: true });
  const certPath = join(certsDir, "device.crt");
  const keyPath = join(certsDir, "device.key");

  if (existsSync(certPath) && existsSync(keyPath)) {
    const certPem = readFileSync(certPath, "utf8");
    const keyPem = readFileSync(keyPath, "utf8");
    return { certPem, keyPem, fingerprint: certFingerprint(certPem) };
  }

  const pems = selfsigned.generate([{ name: "commonName", value: "envsync-device" }], {
    days: 3650,
    keySize: 2048,
    algorithm: "sha256",
  });

  writeFileSync(certPath, pems.cert);
  writeFileSync(keyPath, pems.private);
  return {
    certPem: pems.cert,
    keyPem: pems.private,
    fingerprint: certFingerprint(pems.cert),
  };
}
