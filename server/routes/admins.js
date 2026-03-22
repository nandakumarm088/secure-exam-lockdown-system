// lockdown-server/routes/admins.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../auth/jwtMiddleware');
const { hashPassword } = require('../auth/hashUtils');
const crypto = require('crypto');
const { sendSetPasswordEmail } = require('../utils/mailer');
const jwt = require('jsonwebtoken');
const { comparePassword } = require('../auth/hashUtils');
const { readJson } = require('../utils/fileUtils');
const { SECRET } = require('../auth/jwtMiddleware');
const { sendResetPasswordEmail } = require('../utils/mailer');

const usersPath = path.join(__dirname, '../auth/users.json');

function readUsers() {
  try { return JSON.parse(fs.readFileSync(usersPath, 'utf-8')); }
  catch { return []; }
}
function writeUsers(users) {
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2), 'utf-8');
}

const LINK_EXPIRY_MINUTES = 60;  // adjust for testing/production

const router = express.Router();

router.get('/admins', authenticateToken, (req, res) => {
  const users = readUsers().map(({ password, pwdToken, expiresAt, ...safe }) => safe);
  res.json(users);
});

// Token validation (GET, can be checked repeatedly until used/expired)
router.get('/admins/:username/validate-setup-token', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ valid: false, message: 'Token required.' });
  let users = readUsers();
  let user = users.find(u => u.username === req.params.username);
  if (
    !user || !user.pwdToken || user.pwdToken !== token ||
    !user.expiresAt || user.expiresAt < Date.now()
  ) {
    return res.status(403).json({ valid: false, message: 'Invalid or expired token.' });
  }
  res.json({ valid: true });
});

// Duplication check for add/edit admin
router.post('/admins/validate', authenticateToken, (req, res) => {
  if (req.user?.role !== 'super_admin')
    return res.status(403).json({ message: 'Only super admins can add/edit admins.' });

  const { username, email, currentUsername } = req.body;
  if (!username || !email)
    return res.status(400).json({ message: 'Missing user fields.' });

  let users = readUsers();
  if (users.find(u => u.username === username && u.username !== currentUsername))
    return res.status(400).json({ message: 'Username already exists.' });

  if (users.find(u =>
    u.email && u.email.toLowerCase() === email.toLowerCase() && u.username !== currentUsername)) {
    return res.status(400).json({ message: 'Email already in use.' });
  }
  res.json({ valid: true });
});

// Add admin (protected)
router.post('/admins', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'super_admin')
    return res.status(403).json({ message: 'Only super admins can add admins.' });

  const { username, email, role } = req.body;
  if (!username || !email || !role)
    return res.status(400).json({ message: 'Missing user fields.' });

  let users = readUsers();
  if (users.find(u => u.username === username))
    return res.status(400).json({ message: 'Username already exists.' });

  if (users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase()))
    return res.status(400).json({ message: 'Email already in use.' });

  const setupToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + LINK_EXPIRY_MINUTES * 60 * 1000;
  users.push({
    username, email, role, password: null, pwdToken: setupToken, expiresAt
  });
  writeUsers(users);

  const appHost = process.env.APP_HOST || 'http://localhost:3000';
  const setupLink = `${appHost}/admin/setup-password?username=${encodeURIComponent(username)}&token=${setupToken}`;

  try {
    await sendSetPasswordEmail({ to: email, username, setupLink });
  } catch (err) {
    users = users.filter(u => u.username !== username);
    writeUsers(users);
    return res.status(500).json({
      message: 'Could not send setup email: ' +
        (err && err.message ? err.message : String(err))
    });
  }
  res.status(201).json({ message: 'Admin created. Email sent.' });
});

router.put('/admins/:username', authenticateToken, (req, res) => {
  if (req.user?.role !== 'super_admin')
    return res.status(403).json({ message: 'Only super admins can edit admins.' });

  let { username, email } = req.body;
  let users = readUsers();
  let idx = users.findIndex(u => u.username === req.params.username);
  if (idx === -1) return res.status(404).json({ message: 'Admin not found.' });

  if (username && username !== req.params.username)
    if (users.find(u => u.username === username))
      return res.status(400).json({ message: 'Username already taken.' });

  if (email && users.some(u => u.username !== req.params.username && u.email.toLowerCase() === email.toLowerCase()))
    return res.status(400).json({ message: 'Email already in use.' });

  users[idx].username = username || users[idx].username;
  users[idx].email = email || users[idx].email;
  writeUsers(users);
  res.json({ message: 'Admin updated.' });
});

router.delete('/admins/:username', authenticateToken, (req, res) => {
  if (req.user?.role !== 'super_admin')
    return res.status(403).json({ message: 'Only super admins can remove admins.' });
  if (req.params.username === 'superadmin')
    return res.status(400).json({ message: 'Cannot remove superadmin.' });

  let users = readUsers();
  let idx = users.findIndex(u => u.username === req.params.username);
  if (idx === -1) return res.status(404).json({ message: 'Admin not found.' });
  users.splice(idx, 1);
  writeUsers(users);
  res.json({ message: 'Admin deleted.' });
});

// Reset via direct password set
router.post('/admins/:username/reset-password', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'super_admin')
    return res.status(403).json({ message: 'Only super admins can reset passwords.' });

  let { password } = req.body;
  if (!password || typeof password !== "string" || password.length < 8)
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });

  let users = readUsers();
  let user = users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ message: 'Admin not found.' });

  user.password = await hashPassword(password);
  writeUsers(users);
  res.json({ message: 'Password updated.' });
});

// Request password reset link (with expiry!)
router.post('/admins/:username/request-reset-password', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'super_admin')
    return res.status(403).json({ message: 'Only super admins can send reset links.' });

  let users = readUsers();
  const user = users.find(u => u.username === req.params.username);
  if (!user)
    return res.status(404).json({ message: 'User not found.' });

  const resetToken = crypto.randomBytes(32).toString('hex');
  user.pwdToken = resetToken;
  user.expiresAt = Date.now() + LINK_EXPIRY_MINUTES * 60 * 1000;
  writeUsers(users);

  const appHost = process.env.APP_HOST || 'http://localhost:3000';
  const resetLink = `${appHost}/admin/setup-password?username=${encodeURIComponent(user.username)}&token=${resetToken}`;

  try {
    await sendResetPasswordEmail({
      to: user.email,
      username: user.username,
      resetLink
    });
  } catch (err) {
    return res.status(500).json({
      message: 'Failed to send reset email: ' +
        (err && err.message ? err.message : String(err))
    });
  }
  res.json({ message: `Password reset link sent to ${user.email}` });
});

router.post('/login/verify-password', authenticateToken, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ valid: false, message: "Password required." });

  const users = readJson(usersPath);
  if (!users) return res.status(500).json({ valid: false, message: 'Server error' });

  const user = users.find(u => u.username === req.user.username);
  if (!user || !user.password)
    return res.status(401).json({ valid: false, message: "Invalid user." });

  const isValid = await comparePassword(password, user.password);
  if (!isValid) return res.status(401).json({ valid: false, message: "Wrong password." });
  res.json({ valid: true });
});

// Set password via token (first time or reset - token must still exist & not expired)
router.post('/admins/:username/setup-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || typeof password !== "string" || password.length < 8)
    return res.status(400).json({ message: 'Token required and password must be at least 8 characters.' });

  let users = readUsers();
  const user = users.find(u => u.username === req.params.username);
  if (
    !user ||
    !user.pwdToken ||
    user.pwdToken !== token ||
    !user.expiresAt ||
    user.expiresAt < Date.now()
  ) {
    return res.status(403).json({ message: 'Invalid or expired token.' });
  }

  user.password = await hashPassword(password);
  delete user.pwdToken;
  delete user.expiresAt;
  writeUsers(users);

  res.json({ message: 'Password set. You may now log in.' });
});

module.exports = router;
