const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';

/**
 * Encrypt a plaintext string using AES-256-CBC.
 * Returns "iv:ciphertext" (both hex-encoded).
 */
const encrypt = (text) => {
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
};

/**
 * Decrypt a string previously encrypted with `encrypt()`.
 */
const decrypt = (encryptedText) => {
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const [ivHex, ciphertext] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

module.exports = { encrypt, decrypt };
