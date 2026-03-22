// lockdown-server/routes/clients.js
const express = require('express');
const router = express.Router();
const path = require('path');
const { safeReadJson, safeWriteJson } = require('../utils/fileUtils');

const CLIENTS_PATH = path.join(__dirname, '../data/clients.json');

const { clientsMap } = require('../websocket'); // for direct client messaging
const { broadcastToAdmins } = require('../websocket'); // we’ll expose this too

// PATCH /api/clients/:uuid → update lab or id, then broadcast to admins + client
router.patch('/:uuid', async (req, res) => {
  const { uuid } = req.params;
  const { lab, id } = req.body;

  const clients = await safeReadJson(CLIENTS_PATH) || [];
  const index = clients.findIndex(c => c.uuid === uuid);
  if (index === -1) return res.status(404).json({ success: false, message: 'Client not found' });

  const client = clients[index];
  if (lab) client.lab = lab;
  if (id) client.id = id;

  await safeWriteJson(CLIENTS_PATH, clients);

  const updatedClient = { ...client };

  // 🔁 Broadcast update to admins
  broadcastToAdmins({ type: 'client-update', client: updatedClient });

  // 🔁 Push to this specific client if connected
  const clientSocket = clientsMap.get(client.id);
  if (clientSocket && clientSocket.readyState === 1) {
    clientSocket.send(JSON.stringify({
      type: 'client-update',
      ...updatedClient
    }));
  }

  res.json({ success: true, client: updatedClient });
});

// GET /api/clients/check/:uuid
router.get('/check/:uuid', async (req, res) => {
  const uuid = req.params.uuid;
  const clients = await safeReadJson(CLIENTS_PATH) || [];
  const existing = clients.find(c => c.uuid === uuid);
  if (existing) return res.json({ success: true, ...existing });
  res.status(404).json({ success: false, message: 'Not registered' });
});

// GET /api/clients/all (temporary viewer)
router.get('/all', async (req, res) => {
  const clients = await safeReadJson(CLIENTS_PATH) || [];
  res.json(clients);
});

// POST /api/clients/register
router.post('/register', async (req, res) => {
  const { uuid, hostname, ip, lab, mac } = req.body;
  if (!uuid || !hostname || !lab) {
    return res.status(400).json({ success: false, message: 'Missing fields' });
  }

  const clients = await safeReadJson(CLIENTS_PATH) || [];
  let client = clients.find(c => c.uuid === uuid);
  if (client) {
    client.hostname = hostname;
    client.ip = ip;
    client.lab = lab;
    client.mac = mac || client.mac;
  } else {
    // Determine next client ID
    const existingIds = clients.map(c => c.id.replace(/^CL0*/, '')).map(n => parseInt(n, 10));
    const next = existingIds.length ? Math.max(...existingIds) + 1 : 1;
    const id = 'CL' + String(next).padStart(3, '0');
    client = { uuid, id, hostname, ip, lab, mac: mac || '', locked: false };
    clients.push(client);
  }

  await safeWriteJson(CLIENTS_PATH, clients);
  res.json({ success: true, id: client.id, lab: client.lab, hostname, ip });
});

module.exports = router;
