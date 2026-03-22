// lockdown-server/routes/pin.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { authenticateToken } = require('../auth/jwtMiddleware');
const { hashPassword } = require('../auth/hashUtils');
const { broadcastToClients } = require('../websocket');

const pinPath = path.join(__dirname, '../data/pin-hash.json');

function getPinHash() {
  try {
    const data = fs.readFileSync(pinPath, 'utf-8');
    const { pinHash } = JSON.parse(data);
    return typeof pinHash === "string" ? pinHash : null;
  } catch {
    return null;
  }
}

const router = express.Router();

// (Already existing) Set admin PIN...
router.post('/pin', authenticateToken, async (req, res) => {
  const { pin } = req.body;
  if (
    typeof pin !== "string" ||
    !/^\d{4,10}$/.test(pin) ||
    ["0000","1111","1234","4321","4444","7777","9999"].includes(pin) ||
    /^(\d)\1+$/.test(pin)
  ) {
    return res.status(400).json({ success: false, message: "PIN must be 4-10 digits, and not a simple pattern." });
  }
  try {
    const hash = await hashPassword(pin);
    fs.mkdirSync(path.dirname(pinPath), { recursive: true });
    fs.writeFileSync(pinPath, JSON.stringify({ pinHash: hash }, null, 2), 'utf-8');
    broadcastToClients({ type: "updatePin", pinHash: hash });
    res.json({ success: true, message: "PIN updated." });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error: PIN not updated." });
  }
});

// NEW: Check PIN from client (no auth needed, only checks a PIN against stored hash)
router.post('/pin/check', async (req, res) => {
  const { pin } = req.body;
  const hash = getPinHash();
  if (!hash) return res.status(500).json({ success: false, message: "No PIN set." });
  if (typeof pin !== "string" || !/^\d{4,10}$/.test(pin)) {
    return res.status(400).json({ success: false, message: "Invalid PIN format." });
  }
  try {
    const isMatch = await bcrypt.compare(pin, hash);
    res.json({ success: isMatch });
  } catch {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

router.get('/pin/hash', (req, res) => {
  const hash = getPinHash();
  if (!hash) return res.status(404).json({ success: false });
  res.json({ pinHash: hash });
});

module.exports = router;
