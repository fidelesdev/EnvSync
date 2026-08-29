import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import selfsigned from "selfsigned";

export type DeviceIdentity = {
  fingerprint: string;
  certPem: string;
  keyPem: string;
};

export function certFingerprintFromDer(der: Buffer | Uint8Array): string {
  return createHash("sha256").update(der).digest("hex");
}

export function certFingerprint(certPem: string): string {
  const body = certPem
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s+/g, "");
  return certFingerprintFromDer(Buffer.from(body, "base64"));
}

/** Fingerprint do certificado peer em conexão TLS (compatível com certFingerprint). */
export function peerCertFingerprint(socket: {
  getPeerCertificate: (detailed?: boolean) => { raw?: Buffer; fingerprint256?: string };
}): string {
  const cert = socket.getPeerCertificate(true);
  if (cert?.raw && cert.raw.length > 0) {
    return certFingerprintFromDer(cert.raw);
  }
  if (typeof cert?.fingerprint256 === "string" && cert.fingerprint256) {
    return cert.fingerprint256.replace(/:/g, "").toLowerCase();
  }
  return "";
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
