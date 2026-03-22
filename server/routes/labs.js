// lockdown-server/routes/labs.js
const express = require('express');
const router = express.Router();
const { safeReadJson, safeWriteJson } = require('../utils/fileUtils');
const path = require('path');

const LABS_PATH = path.join(__dirname, '../data/labs.json');

router.get('/labs', async (req, res) => {
  try {
    const labs = await safeReadJson(LABS_PATH);
    res.json(labs);
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to read labs.' });
  }
});

module.exports = router;
