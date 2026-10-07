const REQUIRED_ALWAYS = ['MONGO_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY', 'FRONTEND_URL'];
const REQUIRED_PRODUCTION = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'GOOGLE_CLIENT_ID',
];

function validateEnvironment() {
  const required = process.env.NODE_ENV === 'production'
    ? [...REQUIRED_ALWAYS, ...REQUIRED_PRODUCTION]
    : REQUIRED_ALWAYS;
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);

  if (!/^[a-f\d]{64}$/i.test(process.env.ENCRYPTION_KEY)) {
    throw new Error('ENCRYPTION_KEY must be a 32-byte value encoded as 64 hexadecimal characters');
  }
  if ((process.env.JWT_ACCESS_SECRET || '').length < 32 || (process.env.JWT_REFRESH_SECRET || '').length < 32) {
    throw new Error('JWT secrets must each contain at least 32 characters');
  }

  if (process.env.NODE_ENV === 'production') {
    const brevoConfigured = Boolean(process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL);
    const resendConfigured = Boolean(process.env.RESEND_API_KEY);
    const smtpConfigured = Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
    if (!brevoConfigured && !resendConfigured && !smtpConfigured) {
      throw new Error('Configure Brevo, Resend, or SMTP email credentials');
    }
  }
}

module.exports = validateEnvironment;
