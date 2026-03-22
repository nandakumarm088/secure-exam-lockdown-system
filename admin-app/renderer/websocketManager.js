// adminApp\renderer\websocketManager.js

import { SERVER_URL } from './config.js';

let ws = null;
let reconnectTimeout = null;
let pingInterval = null, pongTimeout = null;

const openHandlers = [];
const closeHandlers = [];
const errorHandlers = [];
const messageHandlers = Object.create(null);

/** Register for message types (e.g., 'client-update') */
function onMessage(type, handler) {
  messageHandlers[type] = handler;
}

/** Register a callback for websocket open event */
function onOpen(fn) { openHandlers.push(fn); }
/** Register a callback for websocket close event */
function onClose(fn) { closeHandlers.push(fn); }
/** Register a callback for websocket error event */
function onError(fn) { errorHandlers.push(fn); }

/**
 * Returns live ws instance; creates (or reconnects) if needed.
 * Use this to send messages.
 */
function getWebSocket() {
  if (!ws || ws.readyState !== WebSocket.OPEN) connectWebSocket();
  return ws;
}

/** Main connect logic — manages all heartbeats, reconnect, low-level wiring */
function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return ws;

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  const wsUrl = SERVER_URL.replace(/^http/, 'ws');
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', (evt) => {
    ws.send(JSON.stringify({ type: 'admin-init' }));
    openHandlers.forEach(fn => fn(evt));
    startHeartbeat();
  });

  ws.addEventListener('close', (evt) => {
    stopHeartbeat();
    closeHandlers.forEach(fn => fn(evt));
    reconnectTimeout = setTimeout(connectWebSocket, 3000); // robust auto-reconnect
  });

  ws.addEventListener('error', (evt) => {
    stopHeartbeat();
    errorHandlers.forEach(fn => fn(evt));
    // Don't reconnect here; wait for close.
  });

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'pong' && pongTimeout) clearTimeout(pongTimeout);
      if (msg.type && messageHandlers[msg.type]) {
        messageHandlers[msg.type](msg);
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });

  return ws;
}

function startHeartbeat() {
  stopHeartbeat();
  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'ping' }));
        pongTimeout = setTimeout(() => {
          reconnectWebSocket();
        }, 3000); // no pong response, force reconnect
      } catch (e) { /* ignore */ }
    }
  }, 8000);
}

function stopHeartbeat() {
  if (pingInterval) clearInterval(pingInterval);
  if (pongTimeout) clearTimeout(pongTimeout);
  pingInterval = null; pongTimeout = null;
}

/** Manual reconnect: closes & immediately opens a new socket. */
function reconnectWebSocket() {
  stopHeartbeat();
  if (ws) {
    ws.close();
    ws = null;
  }
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  reconnectTimeout = null;
  return connectWebSocket();
}

export {
  getWebSocket,
  connectWebSocket,
  reconnectWebSocket,
  onMessage,
  onOpen,
  onClose,
  onError
};
