// clientApp\main.js

const { app, BrowserWindow, globalShortcut, dialog, Tray, Menu, nativeImage, ipcMain } = require('electron');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const axios = require('axios');
const { machineIdSync } = require('node-machine-id');
const WebSocket = require('ws');
const { DateTime } = require('luxon');
const { getPinModalHTML } = require('./pinModalTemplate.js');
const bcrypt = require('bcrypt');



let mainWindow = null;
let tray = null;
let startupMinimized = false;
let pipeClient = null;
let lockdownMode = false;
let isPipeConnected = false;
let helperProcess = null;
let ws = null;
let clientMeta = null;
let isOfflineBannerVisible = false;
let heartbeatInterval = null;
let heartbeatFailCount = 0;
let lastHeartbeatPayload = null;
let lastExamLinkLoaded = null;
let fallbackRetryTimer = null;
let wsUserClosed = false;
let wsReconnectInterval = null;



// Files/Paths
const SERVER_URL = 'https://lockdown-server-production.up.railway.app';
const username = os.userInfo().username;
const PIPE_NAME = `\\\\.\\pipe\\LockdownPipe_${username}`;
const LOCKDOWN_STATE_FILE = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'LockdownApp',
  'lockdown_state.json'
);
const CLIENT_CONFIG_FILE = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'LockdownApp',
  'client_config.json'
);
const PIN_HASH_FILE = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'LockdownApp',
  'pin-hash.json'
);



if (process.platform === 'win32') {
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
    });
  } catch (e) {
    console.error('Error enabling startup:', e);
  }
}



// ---- UNCAUGHT ERROR GUARDS ----
process.on('uncaughtException', (err) => {
  logFatal('UncaughtException', err);
});
process.on('unhandledRejection', (reason, p) => {
  logFatal('UnhandledPromise', reason);
});
function logFatal(type, err) {
  // Also save to a crash log (best practice, for post-mortem crash analysis)
  try {
    const crashInfo = `[${new Date().toISOString()}][${type}]: ${err && err.stack ? err.stack : String(err)}\n`;
    fs.appendFileSync(path.join(__dirname, 'lockdown_crash.log'), crashInfo);
  } catch (_){}
  // Optionally, alert administrator / system tray balloon on fatal
  console.error(`[FATAL:${type}]`, err);
}



// ---- SINGLE INSTANCE ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      try { mainWindow.show(); mainWindow.focus(); } catch(e){}
    }
  });
}



// ---- MAIN WINDOW ----
function createMainWindow(show = true) {
  if (mainWindow) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    kiosk: false,
    show: show,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    }
  });
  
  mainWindow.setMenu(null);


  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });



  return mainWindow;
}



// ---- TRAY ----
function createTray() {
  if (tray) return tray;
  let trayIconPath = path.join(__dirname, 'tray.ico');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(trayIconPath);
    if (trayIcon.isEmpty()) throw new Error('Invalid tray icon');
  } catch (err) {
    trayIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.ico')); // fallback
  }
  tray = new Tray(trayIcon);



  const trayMenu = Menu.buildFromTemplate([
    { label: "Open Lockdown App", click: () => { showMainWindow(); } },
    { label: "Quit", click: () => {
      app.isQuitting = true;
      app.quit();
    }}
  ]);
  tray.setContextMenu(trayMenu);
  tray.setToolTip("Lockdown App");



  tray.on('double-click', () => {
    showMainWindow();
  });
  return tray;
}



function showMainWindow() {
  if (mainWindow) {
    try { mainWindow.show(); mainWindow.focus(); } catch(e){}
  }
}



// ---- FILE / PIN MANAGEMENT ----
function safeWriteFileSync(file, contents) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, 'utf8');
  } catch (err) {
    logFatal('SafeWrite', err);
  }
}
function savePinHashLocal(pinHash) {
  try {
    safeWriteFileSync(PIN_HASH_FILE, JSON.stringify({ pinHash }, null, 2));
  } catch (err) {
    logFatal('PinHashSave', err);
  }
}
function loadPinHashLocal() {
  try {
    if (!fs.existsSync(PIN_HASH_FILE)) return null;
    const raw = fs.readFileSync(PIN_HASH_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return data && data.pinHash ? data.pinHash : null;
  } catch (e) {
    logFatal('PinHashLoad', e);
    return null;
  }
}



// Robust PIN checking
async function checkPinOffline(plainPin) {
  const hash = loadPinHashLocal();
  if (!hash) return null;
  try {
    return await bcrypt.compare(plainPin, hash);
  } catch (e) {
    logFatal('PinCompare', e);
    return null;
  }
}
async function fetchAndStorePinHash() {
  try {
    const res = await axios.get(`${SERVER_URL}/api/pin/hash`, { timeout: 5000 });
    if (res.data && res.data.pinHash) {
      savePinHashLocal(res.data.pinHash);
      return res.data.pinHash;
    }
  } catch (err) {
    console.warn('⚠️ Unable to fetch PIN hash from server:', err.message);
  }
  if (!fs.existsSync(PIN_HASH_FILE)) {
    safeWriteFileSync(PIN_HASH_FILE, JSON.stringify({ pinHash: null }, null, 2));
  }
  return loadPinHashLocal();
}



// ---- LOCKDOWN STATE ----
// All file ops are safe-guarded
function ensureLockdownStateFile() {
  try {
    const dir = path.dirname(LOCKDOWN_STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    safeWriteFileSync(LOCKDOWN_STATE_FILE, JSON.stringify({ lockdownMode: false }, null, 2));
  } catch (err) {
    logFatal('EnsureLockdownStateFile', err);
  }
}
function resetLockdownState() {
  try {
    if (!fs.existsSync(LOCKDOWN_STATE_FILE)) ensureLockdownStateFile();
    safeWriteFileSync(LOCKDOWN_STATE_FILE, JSON.stringify({ lockdownMode: false }, null, 2));
  } catch (err) {
    logFatal('ResetLockdownState', err);
  }
}
function updateLockdownStateFile(state) {
  try {
    safeWriteFileSync(LOCKDOWN_STATE_FILE, JSON.stringify({ lockdownMode: state }, null, 2));
  } catch (err) {
    logFatal('UpdateLockdownState', err);
  }
}
function sendInitialLockdownStatus() {
  try {
    if (!fs.existsSync(LOCKDOWN_STATE_FILE)) return;
    const content = fs.readFileSync(LOCKDOWN_STATE_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    const initialStatus = parsed.lockdownMode === true ? 'lockdown_on' : 'lockdown_off';
    sendCommandToHelper(initialStatus);
  } catch (err) {
    logFatal('SendInitialLockdownStatus', err);
  }
}


function getHelperPath() {
  const isDev = !app.isPackaged;
  if (isDev) {
    return path.join(__dirname, 'LockdownHelper', 'LockdownHelper.exe');
  }
  return path.join(process.resourcesPath, 'app.asar.unpacked', 'LockdownHelper', 'LockdownHelper.exe');
}


let helperRestartDelayMs = 1000; // initial restart delay

function startHelper() {
  try {
    if (helperProcess) return;
    const helperPath = getHelperPath();
    if (!fs.existsSync(helperPath)) {
      throw new Error("LockdownHelper.exe is missing");
    }
    helperProcess = spawn(helperPath, [], { detached: false, stdio: 'inherit' });
    helperProcess.unref();
    helperProcess.on('exit', (code) => {
      console.warn(`⚠️ Helper exited with code ${code}, restarting in ${helperRestartDelayMs}ms...`);
      helperProcess = null;
      setTimeout(() => {
        startHelper();
        connectToPipe();
        // Optionally increase the delay a bit up to a maximum value
        helperRestartDelayMs = Math.min(helperRestartDelayMs * 2, 20000);
      }, helperRestartDelayMs);
    });
    // Reset the delay if started successfully
    helperRestartDelayMs = 1000;
  } catch (err) {
    logFatal('StartHelper', err);
  }
}


function connectToPipe() {
  if (pipeClient || isPipeConnected) return;
  try {
    pipeClient = net.createConnection(PIPE_NAME);
    pipeClient.on('connect', () => {
      isPipeConnected = true;
      sendInitialLockdownStatus();
    });
    pipeClient.on('error', (err) => {
      logFatal('PipeError', err);
      reconnectPipe();
    });
    pipeClient.on('close', () => {
      reconnectPipe();
    });
    pipeClient.on('data', (data) => { /* logging only (do not throw) */
      const msg = data.toString().trim();
      if (msg) console.log(`📩 Helper: ${msg}`);
    });
  } catch (e) {
    logFatal('ConnectToPipeFail', e);
  }
}
function reconnectPipe() {
  isPipeConnected = false;
  if (pipeClient) {
    try { pipeClient.destroy(); } catch {}
    pipeClient = null;
  }
  setTimeout(connectToPipe, 1000);
}
function sendCommandToHelper(command) {
  try {
    if (!pipeClient || !isPipeConnected) return;
    pipeClient.write(`${command}\n`, (err) => {
      if (err) logFatal('PipeSend', err);
    });
  } catch (e) {
    logFatal('SendCmdToHelper', e);
  }
}



// ---- HEARTBEAT: Robust, with auto-retries, recover from offline ----
function sendHeartbeat(force = false) {
  try {
    // Only send if websocket ready, and have meta info
    if (!ws || ws.readyState !== ws.OPEN || !clientMeta) {
      console.log('[WebSocket] Skipping heartbeat: WS not open or clientMeta missing');
      return;
    }
    // console.log(`[DEBUG] Heartbeat scheduled at:`, new Date().toISOString());
    const payload = {
      type: 'heartbeat',
      id: clientMeta.id,
      uuid: clientMeta.uuid,
      hostname: clientMeta.hostname,
      ip: clientMeta.ip,
      allIps: clientMeta.allIps,
      mac: clientMeta.mac,
      lab: clientMeta.lab,
      locked: lockdownMode,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
    const json = JSON.stringify(payload);


    lastHeartbeatPayload = json;
    // console.log('[WebSocket] Sending heartbeat:', json);
    ws.send(json, (err) => {
      if (err) {
        heartbeatFailCount++;
        if (heartbeatFailCount > 2) {
          console.warn("[heartbeat] WebSocket send error, cleaning up and scheduling reconnect.");
          if (ws && ws.readyState !== ws.CLOSED) {
            try { ws.close(); } catch {}
          }
        }
      } else {
        heartbeatFailCount = 0;
      }
    });
  } catch (err) {
    logFatal('SendHeartbeat', err);
  }
}


// ---- METADATA UPDATE ----
function handleMetadataUpdate(updated) {
  try {
    if (!updated || !clientMeta) return;
    const newMeta = { ...clientMeta };
    let changed = false;
    if (typeof updated.id === 'string' && updated.id.trim() !== clientMeta.id) {
      newMeta.id = updated.id.trim();
      changed = true;
    }
    if (typeof updated.lab === 'string' && updated.lab.trim() !== clientMeta.lab) {
      newMeta.lab = updated.lab.trim();
      changed = true;
    }
    if (!changed) return;
    clientMeta = newMeta;
    saveClientConfig(clientMeta);
    if (mainWindow?.webContents) {
      if (updated.lab) {
        mainWindow.webContents.executeJavaScript(
          `window.lockdownClient?.setLabName(${JSON.stringify(clientMeta.lab)});`).catch(()=>{});
      }
      if (updated.id) {
        mainWindow.webContents.executeJavaScript(
          `window.lockdownClient?.setClientID(${JSON.stringify(clientMeta.id)});`).catch(()=>{});
      }
    }
  } catch (err) {
    logFatal('HandleMetadataUpdate', err);
  }
}



// ---- LOCKDOWN HANDLERS ----
function activateLockdown() {
  try {
    lockdownMode = true;
    sendCommandToHelper('lockdown_on');
    updateLockdownStateFile(true);
    if (mainWindow) {
      mainWindow.show();
      mainWindow.setAlwaysOnTop(true);
      mainWindow.focus();
      mainWindow.setKiosk(true);
    }
    sendHeartbeat(true);
  } catch (err) {
    logFatal('ActivateLockdown', err);
  }
}
function deactivateLockdown() {
  try {
    lockdownMode = false;
    sendCommandToHelper('lockdown_off');
    updateLockdownStateFile(false);
    if (mainWindow) {
      mainWindow.setKiosk(false);
      mainWindow.setAlwaysOnTop(false);
      try {
        mainWindow.show();
        mainWindow.focus();
      } catch(e) {
        logFatal('ShowWindowDeactivateLockdown', e);
      }
    }
    sendHeartbeat(true);
  } catch (err) {
    logFatal('DeactivateLockdown', err);
  }
}



// ---- WEBSOCKET ----
function connectWebSocket() {
  // If already open or connecting, do nothing
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (!clientMeta) return;


  try {
    // Clean up any existing socket (if in weird state) AND heartbeat interval
    if (ws) {
      try { ws.close(); } catch {}
      ws = null;
    }
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    wsUserClosed = false;
    ws = new WebSocket(SERVER_URL.replace(/^http/, 'ws'));


    ws.onopen = () => {
      console.log('[WebSocket] Connected');
      if (wsReconnectInterval) {
        clearInterval(wsReconnectInterval);
        wsReconnectInterval = null;
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      lastHeartbeatPayload = null;
      sendHeartbeat(true);


      heartbeatInterval = setInterval(() => {
        try { sendHeartbeat(); } catch (e) {}
      }, 5000);
    };


    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data ?? '{}');
        // Handle all message types as before...
        if (data.type === 'command') {
          if (data.command === 'lockdown_on' && !lockdownMode) {
            showMainWindow();
            activateLockdown();
          }
          if (data.command === 'lockdown_off' && lockdownMode) {
            deactivateLockdown();
          }
        }
        if (data.type === 'updateMetadata' && data.data) {
          handleMetadataUpdate(data.data);
        }
        if (data.type === 'update' && typeof data.examLink === 'string') {
          if (data.examLink && data.examLink !== lastExamLinkLoaded) {
            loadExamPage(mainWindow, data.examLink);
          }
        }
        if (data.type === 'updatePin' && data.pinHash) {
          savePinHashLocal(data.pinHash);
        }
      } catch (err) {
        logFatal('WS Parse', err);
      }
    };


    ws.onclose = (ev) => {
      if (wsUserClosed) return;
      logFatal('WebSocketClosed', ev && ev.code);
      cleanupWebSocket();
      scheduleWebSocketReconnect();
    };


    ws.onerror = (err) => {
      logFatal('WebSocketError', err && err.message);
      if (wsUserClosed) return;
      cleanupWebSocket();
      scheduleWebSocketReconnect();
    };
  } catch (err) {
    logFatal('WebSocketConnect', err);
    cleanupWebSocket();
    scheduleWebSocketReconnect();
  }
}



// ---- PIN MODAL ----
ipcMain.handle('verify-pin', async (_event, pin) => {
  try {
    try {
      const res = await axios.post(`${SERVER_URL}/api/pin/check`, { pin }, { timeout: 4000 });
      if (res.data && res.data.pinHash) savePinHashLocal(res.data.pinHash);
      return !!(res.data && res.data.success);
    } catch (err) {
      return await checkPinOffline(pin);
    }
  } catch (err) {
    logFatal('verify-pin', err);
    return false;
  }
});



// ---- PIN PROMPT ----
let pinModalPromise = null;
let pinModalWindow = null;

async function promptForPin(window) {
  // If a modal is already open or is about to open, reuse the pending promise.
  if (pinModalPromise) return pinModalPromise;

  // Make the promise FIRST, so concurrent calls ALL block on this instance.
  let resolvePromise;
  pinModalPromise = new Promise((resolve) => { resolvePromise = resolve; });

  try {
    pinModalWindow = new BrowserWindow({
      parent: window,
      modal: true,
      show: false,
      width: 310,
      height: 175,
      resizable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
    pinModalWindow.setMenu(null);

    pinModalWindow.loadURL('data:text/html,' + encodeURIComponent(getPinModalHTML()));
    pinModalWindow.once('ready-to-show', () => pinModalWindow.show());

    function cleanup(result) {
      if (pinModalWindow) {
        if (!pinModalWindow.isDestroyed()) pinModalWindow.close();
        pinModalWindow = null;
      }
      pinModalPromise = null;
      resolvePromise(result);
    }

    ipcMain.once('pin-modal-result', (_, pin) => cleanup(pin));
    pinModalWindow.on('closed', () => cleanup(null));
  } catch (err) {
    logFatal('promptForPin', err);
    pinModalPromise = null;
    resolvePromise(null);
  }

  return pinModalPromise;
}



// ---- LOCKDOWN TOGGLE ----
async function toggleLockdownMode() {
  if (!mainWindow) return;
  const pin = await promptForPin(mainWindow);
  if (!pin) return; // Cancelled
  if (!lockdownMode) {
    activateLockdown();
  } else {
    deactivateLockdown();
  }
}



// ---- SHORTCUTS ----
let pinModalShortcutCooldown = false;

function registerShortcuts() {
  try {
    globalShortcut.register('CommandOrControl+L', () => {
      if (mainWindow && mainWindow.isFocused()) {
        if (pinModalShortcutCooldown) return;
        pinModalShortcutCooldown = true;
        setTimeout(() => { pinModalShortcutCooldown = false; }, 250); // 1/4 second lockout
        toggleLockdownMode();
      }
    });
  } catch (e) {}
}




// ---- CLEANUP ----
function cleanup() {
  try {
    globalShortcut.unregisterAll();

    if (pipeClient && isPipeConnected) {
      try { pipeClient.write("shutdown\n"); } catch(e) {}
    }

    if (pipeClient) {
      try { pipeClient.end(); pipeClient.destroy(); } catch {}
      pipeClient = null;
      isPipeConnected = false;
    }
    if (helperProcess) {
      try { process.kill(helperProcess.pid); } catch {}
      helperProcess = null;
    }
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    if (ws) {
      wsUserClosed = true;
      try { ws.close(); } catch {}
      ws = null;
    }
    if (wsReconnectInterval) {
      clearInterval(wsReconnectInterval);
      wsReconnectInterval = null;
    }
    if (fallbackRetryTimer) {
      clearInterval(fallbackRetryTimer);
      fallbackRetryTimer = null;
    }
  } catch (e) {
    logFatal('Cleanup', e);
  }
}




// Helper: clears heartbeat interval, nulls ws
function cleanupWebSocket() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
}



// Persistent, single reconnect timer
async function scheduleWebSocketReconnect() {
  if (wsReconnectInterval) return; // Already scheduled
  wsReconnectInterval = setInterval(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      clearInterval(wsReconnectInterval);
      wsReconnectInterval = null;
      return;
    }
    if (wsUserClosed) {
      clearInterval(wsReconnectInterval);
      wsReconnectInterval = null;
      return;
    }
    // NEW: only attempt if online, to avoid pointless DNS errors
    const online = await reliableCheck();
    if (online) {
      console.log('[WebSocket] Reconnecting...');
      connectWebSocket();
    } else {
      console.log('[WebSocket] Skipping reconnect (offline)');
    }
  }, 3000);
}




// ---- NETWORK INFO ----
function getNetworkDetails() {
  try {
    const interfaces = os.networkInterfaces();
    const ipAddresses = [];
    let macAddress = null;
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ipAddresses.push(iface.address);
          if (!macAddress && iface.mac && iface.mac !== '00:00:00:00:00:00') {
            macAddress = iface.mac;
          }
        }
      }
    }
    return {
      ipAddresses: ipAddresses.length > 0 ? ipAddresses : ['127.0.0.1'],
      macAddress: macAddress || '00:00:00:00:00:00'
    };
  } catch (e) {
    return {
      ipAddresses: ['127.0.0.1'],
      macAddress: '00:00:00:00:00:00'
    };
  }
}



// ---- CLIENT CONFIG (protected) ----
function loadClientConfig() {
  try {
    if (!fs.existsSync(CLIENT_CONFIG_FILE)) return null;
    const raw = fs.readFileSync(CLIENT_CONFIG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    logFatal('LoadClientConfig', err);
    return null;
  }
}


function saveClientConfig(data) {
  try {
    fs.mkdirSync(path.dirname(CLIENT_CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CLIENT_CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    logFatal('SaveClientConfig', err);
  }
}




// ---- INTERNET MONITOR ----
function startInternetMonitor() {
  let wasOnline = true;
  setInterval(async () => {
    let isOnline = false;
    try {
      isOnline = await reliableCheck();
    } catch (e) {
      isOnline = false;
    }
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (isOnline && !wasOnline) {
        mainWindow.webContents.executeJavaScript(`window.lockdownClient?.hideStatusBanner();`).catch(()=>{});
        wasOnline = true;
        isOfflineBannerVisible = false;
      } else if (!isOnline && wasOnline) {
        mainWindow.webContents.executeJavaScript(`window.lockdownClient?.showStatusBanner("Internet disconnected", "error");`).catch(()=>{});
        wasOnline = false;
        isOfflineBannerVisible = true;
      }
    } catch(e){
      // Race condition, ignore
    }
  }, 5000);
}



// ---- REGISTRATION / FETCH LOGIC ----
async function fetchOrRegisterClient(parentWindow) {
  const uuid = machineIdSync();
  const hostname = os.hostname();
  const { ipAddresses, macAddress } = getNetworkDetails();
  const ip = ipAddresses[0];
  try {
    const serverRes = await axios.get(`${SERVER_URL}/api/clients/check/${uuid}`, { timeout: 5000 });
    const serverData = serverRes.data;
    const localData = loadClientConfig();
    if (!localData || localData.id !== serverData.id || localData.lab !== serverData.lab) {
      saveClientConfig({ uuid, id: serverData.id, lab: serverData.lab });
    }
    return serverData;
  } catch (err) {
    if (err.response && (err.response.status === 404 || err.response.data.notFound)) {
      try { if (fs.existsSync(CLIENT_CONFIG_FILE)) fs.unlinkSync(CLIENT_CONFIG_FILE); } catch{}
    } else {
      // Try work offline
      const local = loadClientConfig();
      if (local) return local;
    }
    // prompt registration
    try {
      const labRes = await axios.get(`${SERVER_URL}/api/labs`, { timeout: 7000 });
      const labs = labRes.data || [];
      await parentWindow.loadURL('about:blank');
      const selected = await dialog.showMessageBox(parentWindow, {
        type: 'question',
        buttons: labs,
        title: 'Select Lab',
        message: 'This system is not registered. Select the lab:',
        noLink: true,
        cancelId: -1,
      });
      if (selected.response === -1) {
        app.quit();
        return;
      }
      const lab = labs[selected.response];
      const regRes = await axios.post(`${SERVER_URL}/api/clients/register`, {
        uuid, hostname, ip, lab, mac: macAddress
      });
      const registeredData = regRes.data;
      saveClientConfig({ uuid, id: registeredData.id, lab });
      return registeredData;
    } catch (err) {
      dialog.showErrorBox('Registration Failed', 'Could not complete setup. Try again.');
      app.quit();
      return;
    }
  }
}


async function loadExamPage(window, forceUrl) {
  try {
    let url = forceUrl;
    if (!url) {
      const examRes = await axios.get(`${SERVER_URL}/api/exam-link`, { timeout: 4000 });
      if (examRes.data && examRes.data.link) url = examRes.data.link;
    }
    if (url) {
      if (url !== lastExamLinkLoaded) {
        if (window && !window.isDestroyed()) {
          console.error('loadExamPage: about to load', url);
          // Detach from callstack to avoid event loop/race condition
          setTimeout(async () => {
            try {
              await window.loadURL(url);
              lastExamLinkLoaded = url;
              if (fallbackRetryTimer) { clearInterval(fallbackRetryTimer); fallbackRetryTimer = null; }
            } catch (e) {
              logFatal('loadExamPage: loadURL failed', e);
            }
          }, 50);
        } else {
          console.error('loadExamPage: window is destroyed, not loading URL!');
        }
      }
    } else {
      throw new Error('No exam URL found');
    }
  } catch (err) {
    // fallback to offline page
    try {
      if (window && !window.isDestroyed()) {
        await window.loadFile(path.join(__dirname, 'offline', 'fallback.html'));
        lastExamLinkLoaded = null;
        if (!fallbackRetryTimer) {
          fallbackRetryTimer = setInterval(async () => {
            if (window && !window.isDestroyed() && await reliableCheck()) {
              await loadExamPage(window, forceUrl);
            }
          }, 4000);
        }
      }
    } catch (e) {
      logFatal('LoadFallbackExam', e);
    }
  }
}


async function reliableCheck() {
  const testUrls = [
    'https://www.google.com/generate_204',
    'https://cloudflare.com',
    'https://example.com',
    `${SERVER_URL}/`
  ];
  for (const url of testUrls) {
    try {
      await axios.get(url, { timeout: 3000 });
      return true;
    } catch (e) { continue; }
  }
  return false;
}



async function proceedWithSetup() {
  try {
    const clientInfo = await fetchOrRegisterClient(mainWindow);
    if (!clientInfo) return;
    const { ipAddresses, macAddress } = getNetworkDetails();
    clientMeta = {
      id: clientInfo.id,
      uuid: machineIdSync(),
      hostname: os.hostname(),
      ip: ipAddresses[0],
      allIps: ipAddresses,
      mac: macAddress,
      lab: clientInfo.lab
    };
    connectWebSocket();
    startHelper();
    connectToPipe();
    registerShortcuts();
    await loadExamPage(mainWindow);
  } catch (err) {
    logFatal('ProceedSetup', err);
  }
}



// ---- APP MAIN ENTRY ----
app.on('ready', async () => {
  try {
    resetLockdownState();
    startupMinimized = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAsHidden;
    createTray();
    mainWindow = createMainWindow(!startupMinimized);
    mainWindow.webContents.on('did-finish-load', () => {
      if (clientMeta?.id) {
        mainWindow.webContents.executeJavaScript(
          `window.lockdownClient?.setClientId(${JSON.stringify(clientMeta.id)});`).catch(()=>{});
      }
      if (isOfflineBannerVisible) {
        mainWindow.webContents.executeJavaScript(
          `window.lockdownClient?.showStatusBanner("Internet disconnected", "error");`).catch(()=>{});
      }
    });



    const online = await reliableCheck();
    if (online) {
      await fetchAndStorePinHash();
      await proceedWithSetup();
      startInternetMonitor();
    } else {
      // Offline: show waiting
      await mainWindow.loadFile(path.join(__dirname, 'offline', 'waiting.html'));
      let previouslyLoggedOffline = false;
      const interval = setInterval(async () => {
        const stillOnline = await reliableCheck();
        if (stillOnline) {
          clearInterval(interval);
          await fetchAndStorePinHash();
          await proceedWithSetup();
          startInternetMonitor();
        } else {
          if (!previouslyLoggedOffline) {
            previouslyLoggedOffline = true;
          }
        }
      }, 4000);
    }
  } catch (e) {
    logFatal('AppReady', e);
  }
});



app.on('window-all-closed', (e) => {
  if (process.platform !== 'darwin') {
    e.preventDefault();
  }
});
app.on('before-quit', () => {
  app.isQuitting = true;
  cleanup();
});
app.on('quit', cleanup);
