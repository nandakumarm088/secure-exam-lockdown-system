// lockdown-server/routes/exam.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../auth/jwtMiddleware');
const { broadcastToClients } = require('../websocket');

const examLinkPath = path.join(__dirname, '../data/exam-link.json'); // Create 'data' folder if needed

// Helper to read/save exam link
function getExamLink() {
  try {
    const data = fs.readFileSync(examLinkPath, 'utf-8');
    const { link } = JSON.parse(data);
    return (typeof link === "string") ? link : "";
  } catch (err) {
    return "";
  }
}
function setExamLink(link) {
  fs.mkdirSync(path.dirname(examLinkPath), { recursive: true });
  fs.writeFileSync(examLinkPath, JSON.stringify({ link }, null, 2), 'utf-8');
}

const router = express.Router();

/**
 * GET /api/exam-link
 * Anyone (or you can add authentication)
 */
router.get('/exam-link', (req, res) => {
  const link = getExamLink();
  res.json({ link });
});

/**
 * POST /api/exam-link
 * Only admin/super admin can set (change authenticateToken as needed)
 */
router.post('/exam-link', authenticateToken, (req, res) => {
  const { link } = req.body;
  if (typeof link !== 'string' || !link.trim())
    return res.status(400).json({ success: false, message: 'Missing new exam link.' });

  // Robust url validation
  const isValid =
    /^https?:\/\/[a-zA-Z0-9.-]+[a-zA-Z0-9\/?#=&:_\-%.~]*$/i.test(link) &&
    link.length <= 500;

  if (!isValid)
    return res.status(400).json({ success: false, message: 'Invalid link format (must be a valid http(s) url).' });

  // Optionally, only allow certain domains:
  // if (!/^https:\/\/exam\.yourdomain\.com/.test(link)) { ... }

  setExamLink(link.trim());
  broadcastToClients({ type: 'update', examLink: link.trim() });
  res.json({ success: true, link: link.trim(), message: "Exam link updated." });

  // Optionally: If using WebSocket, notify connected clients here.
});

module.exports = router;
