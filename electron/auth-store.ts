import { app, safeStorage } from "electron";
import fs from "fs";
import path from "path";

type StoredCredentials = {
  email: string;
  password: string;
};

const FILE_NAME = "credentials.bin";

function storePath(): string {
  return path.join(app.getPath("userData"), FILE_NAME);
}

export function canEncrypt(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function loadCredentials(): StoredCredentials | null {
  const file = storePath();
  if (!fs.existsSync(file))
    return null;
  if (!safeStorage.isEncryptionAvailable())
    return null;

  try {
    const encrypted = fs.readFileSync(file);
    const json = safeStorage.decryptString(encrypted);
    const parsed = JSON.parse(json) as StoredCredentials;
    if (!parsed.email || !parsed.password)
      return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCredentials(email: string, password: string): void {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("OS credential encryption is unavailable.");

  const payload = JSON.stringify({ email, password } satisfies StoredCredentials);
  const encrypted = safeStorage.encryptString(payload);
  fs.writeFileSync(storePath(), encrypted);
}

export function clearCredentials(): void {
  const file = storePath();
  if (fs.existsSync(file))
    fs.unlinkSync(file);
}
