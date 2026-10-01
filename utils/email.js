const nodemailer = require('nodemailer');
const logger = require('./logger');

let transporter;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT, 10) || 587,
      secure: Number(process.env.EMAIL_PORT) === 465,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }
  return transporter;
};

/**
 * Send an email.
 * @param {{ to: string, subject: string, html: string }} options
 */
const sendEmail = async ({ to, subject, html }) => {
  try {
    const info = await getTransporter().sendMail({
      from: process.env.EMAIL_FROM || '"CA2gether" <noreply@caconnect.com>',
      to,
      subject,
      html,
    });
    logger.info(`Email sent: ${info.messageId} → ${to}`);
    return info;
  } catch (error) {
    logger.error(`Email send failed: ${error.message}`);
    throw error;
  }
};

/**
 * Send email-verification link.
 */
const sendVerificationEmail = async (email, token) => {
  const link = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
  await sendEmail({
    to: email,
    subject: 'CA2gether — Verify Your Email',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px">
        <h2 style="color:#1a1a2e">Welcome to CA2gether!</h2>
        <p>Click the button below to verify your email address:</p>
        <a href="${link}"
           style="display:inline-block;padding:12px 28px;background:#6c63ff;color:#fff;
                  text-decoration:none;border-radius:6px;font-weight:600;margin:16px 0">
          Verify Email
        </a>
        <p style="font-size:13px;color:#666">This link expires in 24 hours.<br/>
           If you didn't create an account, ignore this email.</p>
      </div>
    `,
  });
};

/**
 * Send password-reset link.
 */
const sendPasswordResetEmail = async (email, token) => {
  const link = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  await sendEmail({
    to: email,
    subject: 'CA2gether — Reset Your Password',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px">
        <h2 style="color:#1a1a2e">Password Reset</h2>
        <p>You requested a password reset. Click below to set a new password:</p>
        <a href="${link}"
           style="display:inline-block;padding:12px 28px;background:#6c63ff;color:#fff;
                  text-decoration:none;border-radius:6px;font-weight:600;margin:16px 0">
          Reset Password
        </a>
        <p style="font-size:13px;color:#666">This link expires in 1 hour.<br/>
           If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
};

module.exports = { sendEmail, sendVerificationEmail, sendPasswordResetEmail };
