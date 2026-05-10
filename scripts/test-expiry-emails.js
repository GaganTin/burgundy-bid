// One-off script: send all three credit-expiry reminder emails to a specific address.
// Usage: node --env-file=.env scripts/test-expiry-emails.js zanrow.co@gmail.com
//
// Bypasses date filtering — useful for QA / design review.
// Delete this file after testing.

import { Resend } from 'resend';
import pg from 'pg';

const targetEmail = process.argv[2];
if (!targetEmail) { console.error('Usage: node --env-file=.env scripts/test-expiry-emails.js <email>'); process.exit(1); }

const resend   = new Resend(process.env.RESEND_API_KEY);
const pool     = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const FROM     = `${process.env.FROM_NAME || 'Burgundy Bid'} <${process.env.FROM_EMAIL || 'support@burgundybid.com'}>`;
const FRONTEND = process.env.FRONTEND_URL || 'https://burgundybid.com';
const upgradeUrl = `${FRONTEND}/Profile?tab=billing`;

function emailTemplate(bodyHtml) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
  <style>body{margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;}</style></head>
  <body><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;">
  <tr><td align="center" style="padding:40px 16px;">
  <table width="600" cellpadding="0" cellspacing="0" border="0"
    style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
  <tr><td style="background:#800020;padding:26px 40px;">
    <span style="color:#fff;font-size:20px;font-weight:700;font-family:Georgia,serif;">Burgundy Bid</span>
  </td></tr>
  <tr><td style="padding:36px 40px;color:#333;font-size:15px;line-height:1.7;">${bodyHtml}</td></tr>
  <tr><td style="background:#f8f8f9;padding:18px 40px;border-top:1px solid #eee;">
    <p style="margin:0;color:#999;font-size:12px;">You're receiving this because you have an account at Burgundy Bid.</p>
  </td></tr></table></td></tr></table></body></html>`;
}

const uR = await pool.query('SELECT full_name FROM users WHERE email=$1', [targetEmail]);
const name = uR.rows[0]?.full_name || targetEmail.split('@')[0] || 'there';
const fakeExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString(); // 7 days from now
const fakePast   = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toLocaleDateString(); // 15 days ago

const emails = [
  {
    label: '7-day warning',
    subject: '[TEST] Your Burgundy Bid credits expire in 7 days',
    body: `
      <p style="margin:0 0 12px;">Hi ${name},</p>
      <p style="margin:0 0 20px;color:#555;">Your Burgundy Bid credits will expire in <strong>7 days</strong> (${fakeExpiry}). Once they expire you won't be able to run new lookups or AI Image Searches.</p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${upgradeUrl}" style="display:inline-block;background:#800020;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:6px;">Upgrade Now</a>
      </div>
      <p style="margin:0;color:#777;font-size:14px;">Upgrading to a Basic or Pro plan gives you a fresh monthly credit allowance and keeps your Wine Searcher and Cellar Tracker connections active.</p>`,
  },
  {
    label: '1-day warning',
    subject: '[TEST] Your Burgundy Bid credits expire tomorrow',
    body: `
      <p style="margin:0 0 12px;">Hi ${name},</p>
      <p style="margin:0 0 20px;color:#555;">This is your final reminder — your Burgundy Bid credits <strong>expire tomorrow</strong>. After that, lookups and AI Image Searches will be blocked until you upgrade.</p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${upgradeUrl}" style="display:inline-block;background:#800020;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:6px;">Upgrade Before It's Too Late</a>
      </div>
      <p style="margin:0;color:#777;font-size:14px;">Your Wine Searcher and Cellar Tracker connections remain active for 30 days after expiry, giving you time to decide.</p>`,
  },
  {
    label: '15-days-after warning',
    subject: '[TEST] Your Burgundy Bid connections will be removed in 15 days',
    body: `
      <p style="margin:0 0 12px;">Hi ${name},</p>
      <p style="margin:0 0 20px;color:#555;">Your Burgundy Bid credits expired 15 days ago (${fakePast}). If you don't upgrade in the next <strong>15 days</strong>, your Wine Searcher and Cellar Tracker connections will be automatically removed to free up capacity.</p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${upgradeUrl}" style="display:inline-block;background:#800020;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:6px;">Reactivate My Account</a>
      </div>
      <p style="margin:0;color:#777;font-size:14px;">You can reconnect your accounts at any time after upgrading, but you'll need to re-enter your credentials.</p>`,
  },
];

for (const e of emails) {
  const { error } = await resend.emails.send({ from: FROM, to: [targetEmail], subject: e.subject, html: emailTemplate(e.body) });
  if (error) console.error(`✗ ${e.label}:`, error.message);
  else        console.log(`✓ ${e.label} sent to ${targetEmail}`);
  await new Promise(r => setTimeout(r, 1000));
}

await pool.end();
