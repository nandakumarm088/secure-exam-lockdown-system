// lockdown-server/utils/mailer.js
// lockdown-server/utils/mailer.js
const { MailerSend, EmailParams, Sender, Recipient } = require('mailersend');

const MAILERSEND_API_TOKEN  = process.env.MAILERSEND_API_TOKEN;
const MAILERSEND_FROM_EMAIL = process.env.MAILERSEND_FROM_EMAIL;
const MAILERSEND_FROM_NAME  = process.env.MAILERSEND_FROM_NAME || "SecureExam Admin";

const mailerSend = new MailerSend({ apiKey: MAILERSEND_API_TOKEN });

// RECOMMENDED EXPIRY: 1 hour
const LINK_EXPIRY_MINUTES = 60;

async function sendMailTemplate({ to, username, subject, html, text }) {
  const sentFrom = new Sender(MAILERSEND_FROM_EMAIL, MAILERSEND_FROM_NAME);
  const recipients = [ new Recipient(to, username || to) ];

  const emailParams = new EmailParams()
    .setFrom(sentFrom)
    .setTo(recipients)
    .setReplyTo(sentFrom)      // Best practice
    .setSubject(subject)
    .setHtml(html)
    .setText(text);

  await mailerSend.email.send(emailParams);
}

// For account setup (first time)
async function sendSetPasswordEmail({ to, username, setupLink }) {
  const subject = "Set up your Lockdown Admin Password";
  const html = `
    <p>Hello <b>${username}</b>,</p>
    <p>Your admin account was created. Please <a href="${setupLink}">set up your password here</a>.</p>
    <p><b>This link will expire in ${LINK_EXPIRY_MINUTES} minutes for your security.</b>
    If you do not set your password within this time, you will need to request a new link from your organization.</p>
    <p>If you did not request this, you can safely ignore this email.</p>
  `;
  const text =
`Hello ${username},

Your admin account was created. Please set up your password here: ${setupLink}

This link will expire in ${LINK_EXPIRY_MINUTES} minutes for your security.
If you do not set your password within this time, you will need to request a new link from your organization.

If you did not request this, you can safely ignore this email.`;
  return sendMailTemplate({ to, username, subject, html, text });
}

// For password reset
async function sendResetPasswordEmail({ to, username, resetLink }) {
  const subject = "Reset your Lockdown Admin Password";
  const html = `
    <p>Hello <b>${username}</b>,</p>
    <p>A password reset was requested for your admin account.</p>
    <p>Please click this link to reset your password: <a href="${resetLink}">${resetLink}</a></p>
    <p><b>This link will expire in ${LINK_EXPIRY_MINUTES} minutes for your security.</b>
    If you did not request this, you can safely ignore this email and no changes will be made.</p>
  `;
  const text =
`Hello ${username},

A password reset was requested for your admin account.

Reset your password here: ${resetLink}

This link will expire in ${LINK_EXPIRY_MINUTES} minutes for your security.
If you did not request this, you can safely ignore this email and no changes will be made.`;
  return sendMailTemplate({ to, username, subject, html, text });
}

module.exports = {
  sendSetPasswordEmail,
  sendResetPasswordEmail
};
