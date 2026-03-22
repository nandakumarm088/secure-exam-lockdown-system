// adminApp\renderer\allClients.js

import { SERVER_URL } from './config.js';
import {
  getWebSocket,
  onMessage,
  onOpen,
  onClose
} from './websocketManager.js';

// ---------- Globals & State ----------
let selectMode = false;
let selectedClientIds = new Set();
let clients = [];
let lastSelectedIndex = null;
let isBulkAction = false;
let modalActiveClientId = null;
let dom;

// ----------- DOM Cache ---------------
function getDomRefs() {
  return {
    clientsList:         document.getElementById('clientsList'),
    searchInput:         document.getElementById('clientSearch'),
    statusFilter:        document.getElementById('statusFilter'),
    selectBtn:           document.getElementById('selectModeBtn'),
    modal:               document.getElementById('clientModal'),
    closeModalBtn:       document.getElementById('closeModal'),
    lockAllBtn:          document.getElementById('lockAllBtn'),
    unlockAllBtn:        document.getElementById('unlockAllBtn'),
    lockSelectedBtn:     document.getElementById('lockSelectedBtn'),
    unlockSelectedBtn:   document.getElementById('unlockSelectedBtn'),
    countDisplay:        document.getElementById('clientCountDisplay'),
    toastContainer:      document.getElementById('toastContainer'),
    // modal-related:
    editLabBtn:          document.getElementById('editLabBtn'),
    labSelectContainer:  document.getElementById('labSelectContainer'),
    labSelectDropdown:   document.getElementById('labSelectDropdown'),
    saveLabBtn:          document.getElementById('saveLabBtn'),
    cancelLabEditBtn:    document.getElementById('cancelLabEditBtn'),
    // modal fields
    modalClientUUID:     document.getElementById('modalClientUUID'),
    modalClientId:       document.getElementById('modalClientId'),
    modalClientHostname: document.getElementById('modalClientHostname'),
    modalClientIP:       document.getElementById('modalClientIP'),
    modalClientLab:      document.getElementById('modalClientLab'),
    modalClientMAC:      document.getElementById('modalClientMAC'),
    modalClientLocked:   document.getElementById('modalClientLocked'),
    modalClientOnline:   document.getElementById('modalClientOnline'),
    modalClientLastSeen: document.getElementById('modalClientLastSeen'),
    modalClientAllIps:   document.getElementById('modalClientAllIps'),
  };
}

// ----------- Toast Functions, Debounce, etc. -----------
function showToast(message, type = 'info', duration = 3000) {
  const toastContainer = dom.toastContainer;
  if (!toastContainer) return;
  const MAX_TOASTS = 5;
  const existingToasts = toastContainer.querySelectorAll('.toast');
  if (existingToasts.length >= MAX_TOASTS) {
    const excess = existingToasts.length - MAX_TOASTS + 1;
    for (let i = 0; i < excess; i++) {
      const toast = existingToasts[i];
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  let icon = '';
  switch (type) {
    case 'success': icon = '✓'; break;
    case 'error': icon = '✗'; break;
    case 'warning': icon = '⚠'; break;
    default: icon = 'ℹ';
  }
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${message}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function showPersistentToast(key, message, type = 'info') {
  const toastContainer = dom.toastContainer;
  if (!toastContainer) return;
  if (toastContainer.querySelector(`.toast[data-key="${key}"]`)) return; // Already displayed
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.dataset.key = key;
  let icon = '';
  switch (type) {
    case 'success': icon = '✓'; break;
    case 'error': icon = '✗'; break;
    case 'warning': icon = '⚠'; break;
    default: icon = 'ℹ';
  }
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${message}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
}

function removeToastByKey(key) {
  const container = dom.toastContainer;
  if (!container) return;
  const toast = container.querySelector(`.toast[data-key="${key}"]`);
  if (toast) {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// --------- MAIN EXPORT FUNCTION ------------
export async function setupAllClientsTab() {
  dom = getDomRefs();
  // Initial fetch & render
  clients = await fetch(`${SERVER_URL}/api/clients/all`).then(res => res.json());
  renderClients(filteredClients());
  updateCountDisplay(filteredClients().length);

  // --- WebSocket Event Handlers (one-time)
  onOpen(() => {
    showToast('Connected to server', 'success', 2000);
    removeToastByKey('ws-reconnect');
  });
  onClose(() => {
    showPersistentToast('ws-reconnect', 'Lost connection. Reconnecting...', 'warning');
  });
  onMessage('client-update', msg => updateClientInList(msg.client));
  onMessage('client-offline', msg => markClientOffline(msg.id, msg.lastSeen));
  onMessage('ack', () => showToast('Connected to server as admin', 'success', 2000));
  // 'pong' handled at socket level for heartbeat

  // --- UI Button Handlers
  dom.lockAllBtn.addEventListener('click', () => sendLockUnlockCommand('broadcast', true));
  dom.unlockAllBtn.addEventListener('click', () => sendLockUnlockCommand('broadcast', false));
  dom.lockSelectedBtn.addEventListener('click', () => sendLockUnlockCommand('targeted', true));
  dom.unlockSelectedBtn.addEventListener('click', () => sendLockUnlockCommand('targeted', false));
  dom.closeModalBtn.addEventListener('click', () => {
    dom.modal.classList.add('hidden');
    modalActiveClientId = null;
  });

  dom.selectBtn.addEventListener('click', () => {
    selectMode = !selectMode;
    dom.selectBtn.textContent = selectMode ? 'Cancel Select' : 'Select';
    if (!selectMode) selectedClientIds.clear();
    dom.clientsList.classList.toggle('select-mode', selectMode);
    renderClients(filteredClients());
  });

  // Debounced Search + Status Filter
  dom.searchInput.addEventListener('input', debounce(filterClients, 200));
  dom.statusFilter.addEventListener('change', filterClients);

  dom.clientsList.addEventListener('click', handleClick);

  setupLabEditHandlersOnce();

  // Modal Lock/Unlock Buttons (once)
  const modalLockBtn = document.getElementById('modalLockBtn');
  const modalUnlockBtn = document.getElementById('modalUnlockBtn');
  if (modalLockBtn && !modalLockBtn.dataset.bound) {
    modalLockBtn.dataset.bound = 'true';
    modalLockBtn.addEventListener('click', () => sendSingleClientCommand('lockdown_on'));
  }
  if (modalUnlockBtn && !modalUnlockBtn.dataset.bound) {
    modalUnlockBtn.dataset.bound = 'true';
    modalUnlockBtn.addEventListener('click', () => sendSingleClientCommand('lockdown_off'));
  }

  // Modal closes on outside click (attach-once)
  if (!window.__modalClickHandlerBound) {
    window.__modalClickHandlerBound = true;
    window.addEventListener('mousedown', (e) => {
      const modal = dom.modal;
      if (!modal || modal.classList.contains('hidden')) return;
      const modalContent = modal.querySelector('.modal-content');
      if (!modalContent.contains(e.target)) {
        modal.classList.add('hidden');
        modalActiveClientId = null;
      }
    });
  }
}

function sendSingleClientCommand(command) {
  const ws = getWebSocket();
  const id = dom.modalClientId.textContent;
  const hostname = dom.modalClientHostname.textContent && dom.modalClientHostname.textContent !== 'N/A'
    ? dom.modalClientHostname.textContent
    : '';
  if (!id) {
    showToast("No client selected in modal", "error");
    return;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast("WebSocket not connected", "error");
    return;
  }
  ws.send(JSON.stringify({
    type: 'targeted-command',
    command,
    clientIds: [id]
  }));
  const action = command === 'lockdown_on' ? 'Lock' : 'Unlock';
  showToast(`${action} command sent to ${id}${hostname ? ` (${hostname})` : ''}`, "success");
}

function sendLockUnlockCommand(mode, shouldLock) {
  const ws = getWebSocket();
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast('WebSocket connection not available', 'error');
    return;
  }
  const command = shouldLock ? 'lockdown_on' : 'lockdown_off';
  const action = shouldLock ? 'Lock' : 'Unlock';
  if (mode === 'targeted') {
    if (selectedClientIds.size === 0) {
      showToast('No clients selected', 'warning');
      return;
    }
    const clientIds = Array.from(selectedClientIds);
    try {
      isBulkAction = true;
      ws.send(JSON.stringify({
        type: 'targeted-command',
        command,
        clientIds,
      }));
      showToast(`${action} command sent to ${clientIds.length} client(s)`, 'success');
      selectedClientIds.clear();
      document.querySelectorAll('.client-item.selected').forEach(el => el.classList.remove('selected'));
      selectMode = false;
      dom.selectBtn.textContent = 'Select';
      dom.clientsList.classList.remove('select-mode');
      setTimeout(() => { isBulkAction = false }, 2000);
    } catch (err) {
      isBulkAction = false;
      showToast(`Failed to send ${action} command`, 'error');
      console.error(err);
    }
  } else {
    try {
      isBulkAction = true;
      ws.send(JSON.stringify({
        type: 'broadcast-command',
        command
      }));
      showToast(`${action} command sent to all clients`, 'success');
      setTimeout(() => { isBulkAction = false }, 2000);
    } catch (err) {
      isBulkAction = false;
      showToast(`Failed to send ${action} command`, 'error');
      console.error(err);
    }
  }
}

// --------- Render and Filter --------------
function renderClients(list) {
  dom.clientsList.innerHTML = list.map(c => {
    const state = c.online
      ? c.locked ? 'online locked' : 'online unlocked'
      : 'offline';
    const isSelected = selectedClientIds.has(c.id);
    return `
      <div class="client-item ${isSelected ? 'selected' : ''}"
        data-id="${c.id}"
        data-hostname="${c.hostname}"
        data-ip="${c.ip}"
        data-lab="${c.lab}"
        data-mac="${c.mac}"
        data-status="${state}"
        data-locked="${c.locked}"
        data-online="${c.online}"
        data-uuid="${c.uuid || ''}"
        data-allips="${(c.allIps || []).join(',')}"
        data-lastseen="${c.lastSeen || ''}"
      >
        <div class="client-info-line">
          <span class="client-id">${c.id}</span>
          <span class="client-lab">${c.lab}</span>
          <span class="client-ip">IP: ${c.ip}</span>
        </div>
        <div class="client-badges">
          <span class="client-badge ${c.online ? 'online' : 'offline'}">${c.online ? 'Online' : 'Offline'}</span>
          <span class="client-badge ${c.locked ? 'locked' : 'unlocked'}">${c.locked ? 'Locked' : 'Unlocked'}</span>
        </div>
      </div>
    `;
  }).join('');
  updateCountDisplay(list.length);
}

function filteredClients() {
  const term = dom.searchInput.value.trim().toLowerCase();
  const statusValue = dom.statusFilter.value;
  return clients.filter(c => {
    const matchesText = `${c.id} ${c.hostname} ${c.lab} ${c.ip} ${(c.allIps||[]).join(' ')}`
      .toLowerCase().includes(term);
    let matchesStatus = false;
    if (statusValue === 'all') matchesStatus = true;
    else if (statusValue === 'online')
      matchesStatus = c.online;
    else if (statusValue === 'offline')
      matchesStatus = !c.online;
    else if (statusValue === 'locked')
      matchesStatus = c.online && c.locked;
    else if (statusValue === 'unlocked')
      matchesStatus = c.online && !c.locked;
    return matchesText && matchesStatus;
  });
}

function updateCountDisplay(count) {
  dom.countDisplay.textContent = `Showing ${count} client${count !== 1 ? 's' : ''}`;
}
function filterClients() {
  renderClients(filteredClients());
}

// ---------- Select / Click Handler ----------
function handleClick(e) {
  const item = e.target.closest('.client-item');
  if (!item) return;
  if (selectMode) {
    toggleSelection(item, e);
  } else {
    showClientModal(item);
  }
}

function toggleSelection(item, e) {
  const allItems = Array.from(dom.clientsList.querySelectorAll('.client-item'));
  const id = item.dataset.id;
  const currentIndex = allItems.indexOf(item);
  if (e.shiftKey && lastSelectedIndex !== null) {
    const [start, end] = [lastSelectedIndex, currentIndex].sort((a, b) => a - b);
    allItems.forEach((el, idx) => {
      if (idx >= start && idx <= end) {
        el.classList.add('selected');
        selectedClientIds.add(el.dataset.id);
      }
    });
  } else if (e.ctrlKey || e.metaKey) {
    if (item.classList.toggle('selected')) {
      selectedClientIds.add(id);
    } else {
      selectedClientIds.delete(id);
    }
    lastSelectedIndex = currentIndex;
  } else {
    allItems.forEach(el => el.classList.remove('selected'));
    selectedClientIds.clear();
    item.classList.add('selected');
    selectedClientIds.add(id);
    lastSelectedIndex = currentIndex;
  }
  window.getSelection().removeAllRanges();
}

function showClientModal(item) {
  try {
    dom.labSelectContainer.classList.add('hidden');
    dom.editLabBtn.classList.remove('hidden');
    modalActiveClientId = item.dataset.id;
    const get = k => item.dataset[k] || 'N/A';
    dom.modalClientUUID.textContent    = get('uuid');
    dom.modalClientId.textContent      = get('id');
    dom.modalClientHostname.textContent= get('hostname');
    dom.modalClientIP.textContent      = get('ip');
    dom.modalClientLab.textContent     = get('lab');
    dom.modalClientMAC.textContent     = get('mac');
    dom.modalClientLocked.textContent  = (item.dataset.locked === 'true') ? 'Yes' : 'No';

    // --- ONLINE BADGE LOGIC ---
    const isOnline = item.dataset.online === 'true';
    const onlineBadge = document.getElementById('modalClientOnlineBadge');
    if (onlineBadge) {
      if (isOnline) {
        onlineBadge.textContent = '● ONLINE';
        onlineBadge.className = 'online-badge online';
      } else {
        onlineBadge.textContent = '● OFFLINE';
        onlineBadge.className = 'online-badge offline';
      }
    }
    dom.modalClientOnline.textContent = isOnline ? 'Yes' : 'No';

    dom.modalClientLastSeen.textContent = get('lastseen');
    const allIpsRaw = item.dataset.allips;
    const allIps = allIpsRaw ? allIpsRaw.split(',') : [];
    dom.modalClientAllIps.innerHTML = allIps.length
      ? allIps.map(ip => `<span class="ip-chip">${ip}</span>`).join(' ')
      : 'N/A';

    dom.modal.classList.remove('hidden');
  } catch (err) {
    console.error('Failed to show modal:', err);
  }
}

function updateClientInList(updatedClient) {
  const index = clients.findIndex(c => c.id === updatedClient.id);
  if (index !== -1) {
    clients[index] = { ...clients[index], ...updatedClient };
  } else {
    clients.push(updatedClient);
  }
  filterClients();
  // Update modal if open for this client
  if (
    dom.modal &&
    !dom.modal.classList.contains('hidden') &&
    modalActiveClientId &&
    updatedClient.id === modalActiveClientId
  ) {
    dom.modalClientUUID.textContent    = updatedClient.uuid || 'N/A';
    dom.modalClientId.textContent      = updatedClient.id || 'N/A';
    dom.modalClientHostname.textContent= updatedClient.hostname || 'N/A';
    dom.modalClientIP.textContent      = updatedClient.ip || 'N/A';
    dom.modalClientLab.textContent     = updatedClient.lab || 'N/A';
    dom.modalClientMAC.textContent     = updatedClient.mac || 'N/A';
    dom.modalClientLocked.textContent  = updatedClient.locked ? 'Yes' : 'No';

    const onlineBadge = document.getElementById('modalClientOnlineBadge');
    if (onlineBadge) {
      if (updatedClient.online) {
        onlineBadge.textContent = '● ONLINE';
        onlineBadge.className = 'online-badge online';
      } else {
        onlineBadge.textContent = '● OFFLINE';
        onlineBadge.className = 'online-badge offline';
      }
    }
    dom.modalClientOnline.textContent = updatedClient.online ? 'Yes' : 'No';
    dom.modalClientLastSeen.textContent = updatedClient.lastSeen || 'N/A';
    const allIps = (updatedClient.allIps || []);
    dom.modalClientAllIps.innerHTML = allIps.length
      ? allIps.map(ip => `<span class="ip-chip">${ip}</span>`).join(' ')
      : 'N/A';
  }
}

function markClientOffline(id, lastSeen) {
  const index = clients.findIndex(c => c.id === id);
  if (index !== -1) {
    clients[index].online = false;
    clients[index].lastSeen = lastSeen;
    filterClients();
  }
  // Sync modal if open
  if (
    dom.modal &&
    !dom.modal.classList.contains('hidden') &&
    modalActiveClientId &&
    id === modalActiveClientId
  ) {
    const onlineBadge = document.getElementById('modalClientOnlineBadge');
    if (onlineBadge) {
      onlineBadge.textContent = '● OFFLINE';
      onlineBadge.className = 'online-badge offline';
    }
    dom.modalClientOnline.textContent = 'No';
    dom.modalClientLastSeen.textContent = lastSeen || 'N/A';
  }
}

// ---- Modal: Lab Edit UI, attach-once ----
function setupLabEditHandlersOnce() {
  const { editLabBtn, labSelectContainer, labSelectDropdown, saveLabBtn, cancelLabEditBtn } = dom;
  if (!editLabBtn || editLabBtn.dataset.bound === 'true') return;
  editLabBtn.dataset.bound = 'true';
  editLabBtn.addEventListener('click', async () => {
    const currentLab = dom.modalClientLab.textContent;
    try {
      const labs = await fetch(`${SERVER_URL}/api/labs`).then(res => res.json());
      labSelectDropdown.innerHTML = labs.map(lab =>
        `<option value="${lab}" ${lab === currentLab ? 'selected' : ''}>${lab}</option>`
      ).join('');
      labSelectContainer.classList.remove('hidden');
      editLabBtn.classList.add('hidden');
    } catch (err) {
      showToast('Failed to fetch lab list', 'error');
      console.error(err);
    }
  });
  cancelLabEditBtn.addEventListener('click', () => {
    labSelectContainer.classList.add('hidden');
    editLabBtn.classList.remove('hidden');
  });
  saveLabBtn.addEventListener('click', async () => {
    const newLab = labSelectDropdown.value;
    const uuid = dom.modalClientUUID.textContent;
    const id = dom.modalClientId.textContent;

    saveLabBtn.disabled = true;
    saveLabBtn.innerHTML = `<span class="spinner"></span> Saving...`;

    try {
      const res = await fetch(`${SERVER_URL}/api/clients/${uuid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lab: newLab })
      });
      if (!res.ok) throw new Error('Failed to update lab');
      dom.modalClientLab.textContent = newLab;
      labSelectContainer.classList.add('hidden');
      editLabBtn.classList.remove('hidden');
      const updatedClient = clients.find(c => c.id === id);
      if (updatedClient) {
        updatedClient.lab = newLab;
        filterClients();
      }
      showToast('Lab updated successfully', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to update lab', 'error');
    } finally {
      saveLabBtn.disabled = false;
      saveLabBtn.textContent = 'Save';
    }
  });
}
