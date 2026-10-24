const crypto = require('crypto');
const { safeStorage } = require('electron');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expected) {
  const { hash } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expected, 'hex'));
}

// Secrets (GitHub tokens, API keys) are encrypted with the OS keychain when it
// is available. On Linux without a keyring, safeStorage falls back to a weaker
// obfuscation, which is still better than plain text on disk.
function encryptSecret(value) {
  if (!value) return null;
  if (safeStorage.isEncryptionAvailable()) {
    return { enc: true, v: safeStorage.encryptString(value).toString('base64') };
  }
  return { enc: false, v: Buffer.from(value).toString('base64') };
}

function decryptSecret(blob) {
  if (!blob) return null;
  try {
    const buf = Buffer.from(blob.v, 'base64');
    return blob.enc ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, encryptSecret, decryptSecret };
