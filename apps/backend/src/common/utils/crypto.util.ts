import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM recomienda 12 bytes
const KEY_BYTES = 32; // AES-256

const GEN_CMD = `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;

/**
 * Carga y valida la clave.
 * Acepta 64 chars hex (32 bytes) o 32 chars crudos (32 bytes ASCII).
 * OJO: validar `Buffer.byteLength(raw,'utf8') === 32` es INCORRECTO para hex,
 * porque 64 chars hex miden 64 bytes como string. Hay que validar los BYTES decodificados.
 */
function loadKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      `Falta ENCRYPTION_KEY (32 bytes).\nGenerala con:\n  ${GEN_CMD}`,
    );
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'utf8');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY debe tener exactamente ${KEY_BYTES} bytes. ` +
        `Actual: ${key.length} bytes (${raw.length} chars).\n` +
        `Generala con:\n  ${GEN_CMD}`,
    );
  }
  return key;
}

let cached: Buffer | null = null;
function getKey(): Buffer {
  if (!cached) cached = loadKey();
  return cached;
}

/** Cifra un texto. Devuelve `iv:tag:ciphertext` en base64. */
export function encrypt(plain: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

/** Descifra un payload generado por `encrypt`. */
export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Payload cifrado invalido');
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const out = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return out.toString('utf8');
}

/** Helper para generar una clave nueva (32 bytes en hex). */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString('hex');
}
