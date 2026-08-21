const fs = require('fs');
const path = require('path');

// Lazily built so a missing SMTP config doesn't crash the app at require-time —
// mirrors getStripe() in orderFulfillment.js, which is also read on first use.
function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
}

const PREVIEW_DIR = path.join(__dirname, '..', '.tmp', 'emails');

// No SMTP configured (e.g. local dev) — write the email to .tmp/emails instead
// of sending it, so the flow can be exercised end-to-end without real credentials.
function previewToDisk(to, subject, html) {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  const file = path.join(PREVIEW_DIR, `${Date.now()}-${to.replace(/[^a-z0-9]/gi, '_')}.html`);
  fs.writeFileSync(file, `<!-- To: ${to} | Subject: ${subject} -->\n${html}`);
  console.log(`[mailer] SMTP not configured — email saved to ${file}`);
  return { previewed: true, file };
}

async function sendMail({ to, subject, html }) {
  if (!to) return { skipped: true, reason: 'no recipient email on file' };
  const transporter = getTransporter();
  if (!transporter) return previewToDisk(to, subject, html);

  return transporter.sendMail({
    from: process.env.SMTP_FROM || 'Ennys <hello@ennys.co.uk>',
    to,
    subject,
    html
  });
}

module.exports = { sendMail };
