// lockdown-server/routes/login.js
const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const { comparePassword } = require('../auth/hashUtils');
const { readJson } = require('../utils/fileUtils');
const { SECRET } = require('../auth/jwtMiddleware');

const router = express.Router();
const usersPath = path.join(__dirname, '../auth/users.json');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ success: false, message: 'Missing credentials' });

  const users = readJson(usersPath);
  if (!users) return res.status(500).json({ success: false, message: 'Server error' });

  const user = users.find(u => u.username === username);
  if (!user || !(await comparePassword(password, user.password))) {
    return res.status(401).json({ success: false, message: 'Invalid login' });
  }

  const payload = { username: user.username, role: user.role };
  const token = jwt.sign(payload, SECRET, { expiresIn: '2h' });

  res.json({
    success: true,
    username: user.username,
    role: user.role,
    token
  });
});

module.exports = router;
