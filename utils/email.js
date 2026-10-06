const nodemailer = require('nodemailer');
const logger = require('./logger');

let transporter;

const getFrontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')[0]
  .trim()
  .replace(/\/$/, '');

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
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return transporter;
};

const sendWithResend = async ({ to, subject, html }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'CA2Gether <onboarding@resend.dev>',
        to: [to],
        subject,
        html,
      }),
      signal: controller.signal,
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.message || `Resend request failed with status ${response.status}`);
      error.statusCode = 502;
      throw error;
    }

    return { messageId: result.id, provider: 'resend' };
  } finally {
    clearTimeout(timeout);
  }
};

const sendWithBrevo = async ({ to, subject, html }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: {
          name: process.env.BREVO_SENDER_NAME || 'CA2Gether',
          email: process.env.BREVO_SENDER_EMAIL,
        },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
      signal: controller.signal,
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.message || `Brevo request failed with status ${response.status}`);
      error.statusCode = 502;
      throw error;
    }

    return { messageId: result.messageId, provider: 'brevo' };
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Send an email.
 * @param {{ to: string, subject: string, html: string }} options
 */
const sendEmail = async ({ to, subject, html }) => {
  try {
    const info = process.env.BREVO_API_KEY
      ? await sendWithBrevo({ to, subject, html })
      : process.env.RESEND_API_KEY
        ? await sendWithResend({ to, subject, html })
        : await getTransporter().sendMail({
          from: process.env.EMAIL_FROM || '"CA2gether" <noreply@caconnect.com>',
          to,
          subject,
          html,
        });
    logger.info(`Email sent through ${info.provider || 'smtp'}: ${info.messageId}`);
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
  const link = `${getFrontendUrl()}/verify-email?token=${token}`;
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
  const link = `${getFrontendUrl()}/reset-password?token=${token}`;
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
