const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const { readJson, writeJson } = require('./utils/fileUtils');

const CLIENTS_FILE = path.join(__dirname, 'data', 'clients.json');
const EXAM_LINK_FILE = path.join(__dirname, 'data', 'exam-link.json');

const clientsMap = new Map();  // clientID → clientSocket
const timezonesMap = new Map(); // clientID → timezone
const adminSet = new Set(); // active admin WebSocket connections

const heartbeatTimers = new Map(); // clientId -> Timeout handle
const HEARTBEAT_TIMEOUT = 20000;   // 15 seconds to wait for heartbeat

function broadcastToClients(message) {
  const json = JSON.stringify(message);
  for (const [id, clientWs] of clientsMap) {
    if (clientWs.readyState === WebSocket.OPEN) {
      try {
        clientWs.send(json);
      } catch (err) {
        console.warn('⚠️ Failed to send to client:', err.message);
      }
    }
  }
}

function getFormattedTimeInZone(zone) {
  try {
    return DateTime.now().setZone(zone).toFormat('yyyy-MM-dd HH:mm:ss');
  } catch {
    return DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss');
  }
}

function broadcastToAdmins(message) {
  const json = JSON.stringify(message);
  for (const admin of adminSet) {
    if (admin.readyState === WebSocket.OPEN) {
      try {
        admin.send(json);
      } catch (err) {
        console.warn('⚠️ Failed to send to admin:', err.message);
      }
    }
  }
}

// Unified helper for timeout/close/error
function markClientOffline(clientId) {
  if (heartbeatTimers.has(clientId)) {
    clearTimeout(heartbeatTimers.get(clientId));
    heartbeatTimers.delete(clientId);
  }
  if (clientsMap.has(clientId)) {
    clientsMap.delete(clientId);
  }
  const clients = readJson(CLIENTS_FILE) || [];
  const index = clients.findIndex(c => c.id === clientId);
  if (index !== -1 && clients[index].online !== false) {
    clients[index].online = false;
    const tz = timezonesMap.get(clientId) || clients[index].timezone || 'UTC';
    clients[index].lastSeen = getFormattedTimeInZone(tz);
    writeJson(CLIENTS_FILE, clients);
    broadcastToAdmins({
      type: 'client-offline',
      id: clientId,
      lastSeen: clients[index].lastSeen
    });
  }
}

function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    console.log('🔌 WebSocket client connected');
    let clientId = null;
    let isAdmin = false;

    ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg);

        // --- Admin-related and broadcast handling as before ---
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        if (data.type === 'broadcast-command') {
          if (!isAdmin) {
            console.warn('Non-admin attempted broadcast command');
            return;
          }
          for (const [id, clientWs] of clientsMap) {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'command',
                command: data.command
              }));
            }
          }
          return;
        }
        if (data.type === 'targeted-command') {
          if (!isAdmin) {
            console.warn('Non-admin attempted targeted command');
            return;
          }
          if (!data.clientIds || !Array.isArray(data.clientIds)) {
            console.warn('Invalid client IDs for targeted command');
            return;
          }
          data.clientIds.forEach(id => {
            const clientWs = clientsMap.get(id);
            if (clientWs && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'command',
                command: data.command
              }));
            }
          });
          return;
        }
        if (data.type === 'admin-init') {
          ws.isAdmin = true;
          isAdmin = true;
          adminSet.add(ws);
          ws.send(JSON.stringify({ type: 'ack', role: 'admin' }));
          console.log('🛠️ Admin dashboard connected');
          return;
        }
        // --- Main heartbeat and client logic (race-safe) ---
        if (data.type === 'heartbeat') {
          clientId = data.id;
          ws.clientId = clientId; // record which ws this is for cleanup
          console.log(`[Server] Got heartbeat for id=${clientId}, uuid=${data.uuid}`);

          // Always set this ws as the current for this clientId
          clientsMap.set(clientId, ws);

          // Heartbeat timeout: only allow THIS ws to clean up if it's still live
          if (heartbeatTimers.has(clientId)) clearTimeout(heartbeatTimers.get(clientId));
          heartbeatTimers.set(
            clientId,
            setTimeout(() => {
              if (clientsMap.get(clientId) === ws) {
                markClientOffline(clientId);
                try { ws.terminate(); } catch {}
              }
            }, HEARTBEAT_TIMEOUT)
          );

          // Write/update client state and push to admins as before:
          const clients = readJson(CLIENTS_FILE) || [];
          const index = clients.findIndex(c => c.id === clientId);
          if (data.timezone) timezonesMap.set(clientId, data.timezone);

          const updatedClient = {
            id: data.id,
            uuid: data.uuid,
            hostname: data.hostname,
            ip: data.ip,
            allIps: data.allIps || [],
            mac: data.mac || '',
            lab: data.lab,
            locked: !!data.locked,
            online: true,
            timezone: data.timezone || '',
            lastSeen: "online"
          };

          if (index !== -1) {
            clients[index] = { ...clients[index], ...updatedClient };
          } else {
            clients.push(updatedClient);
          }
          writeJson(CLIENTS_FILE, clients);

          broadcastToAdmins({ type: 'client-update', client: updatedClient });

          // Push current exam link to this client
          const examLinkData = readJson(EXAM_LINK_FILE);
          if (examLinkData && typeof examLinkData.link === "string") {
            try {
              ws.send(JSON.stringify({
                type: 'update',
                examLink: examLinkData.link
              }));
            } catch (e) {
              console.error('ws.send failed in heartbeat handler:', e);
            }
          } else {
            console.warn('exam-link.json missing or unreadable, not sending update to client');
          }
        }

      } catch (err) {
        console.error('⚠️ WebSocket message error:', err.message);
      }
    });

    ws.on('close', () => {
      console.log('🔌 WebSocket client disconnected');

      if (isAdmin) {
        adminSet.delete(ws);
        console.log('📴 Admin dashboard disconnected');
        return;
      }
      // Only mark as offline if this ws is still the "current" for clientId
      if (clientId && clientsMap.get(clientId) === ws) {
        markClientOffline(clientId);
      }
    });

    ws.on('error', (err) => {
      console.warn(`⚠️ WebSocket error: ${err.message}`);
      if (!isAdmin && clientId && clientsMap.get(clientId) === ws) {
        markClientOffline(clientId);
      }
    });
  });
}

process.on('uncaughtException', (err) => {
  console.error('[SERVER] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, p) => {
  console.error('[SERVER] Unhandled Rejection:', reason);
});

module.exports = {
  setupWebSocket,
  clientsMap,
  broadcastToAdmins,
  broadcastToClients
};
