import nodemailer from 'nodemailer';

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env;
export const mailEnabled = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

const transport = mailEnabled
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 465,
      secure: (Number(SMTP_PORT) || 465) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;

export function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return `http://localhost:${process.env.PORT || 4000}`;
}

// Sample records use made-up addresses; never try to deliver to them.
export const deliverable = (email) => Boolean(email) && !/\.(demo|test)$/i.test(email) && !/@example\.(com|org)$/i.test(email);

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SEV_COLOR = { critical: '#9a2e3a', warning: '#a8771e', info: '#3d5a80' };

export function layout({ heading, intro, items = [], cta, footer }) {
  const rows = items
    .map(
      (i) => `<tr><td style="padding:12px 0;border-bottom:1px solid #e4e1da">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${SEV_COLOR[i.severity] || '#6e6c67'};margin-right:8px"></span>
        <span style="font-size:14px;color:#141414">${esc(i.message)}</span>
        ${i.link ? `<br><a href="${esc(i.link)}" style="font-size:12px;color:#141414;font-weight:700">Open application</a>` : ''}
      </td></tr>`
    )
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#f4f3ef;font-family:Segoe UI,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:20px;padding:28px">
    <tr><td style="font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#6e6c67">AICTE Approvals</td></tr>
    <tr><td style="padding-top:10px;font-size:22px;font-weight:800;color:#141414">${esc(heading)}</td></tr>
    ${intro ? `<tr><td style="padding-top:8px;font-size:14px;color:#3b3b3b;line-height:1.5">${esc(intro)}</td></tr>` : ''}
    ${rows ? `<tr><td style="padding-top:12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>` : ''}
    ${cta ? `<tr><td style="padding-top:20px"><a href="${esc(cta.href)}" style="display:inline-block;background:#141414;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 18px;border-radius:12px">${esc(cta.label)}</a></td></tr>` : ''}
    <tr><td style="padding-top:22px;font-size:12px;color:#6e6c67">${esc(footer || 'You receive this because you have an account on the AICTE Approvals portal.')}</td></tr>
  </table></td></tr></table></body></html>`;
}

export async function sendMail({ to, subject, html, text }) {
  if (!mailEnabled || !deliverable(to)) return false;
  try {
    await transport.sendMail({ from: EMAIL_FROM || `AICTE Approvals <${SMTP_USER}>`, to, subject, html, text });
    return true;
  } catch (err) {
    console.warn(`Email to ${to} failed:`, err.message);
    return false;
  }
}
