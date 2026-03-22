// clientApp/preload.js

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('lockdownClient', {
  setClientId: (clientId) => {
    try {
      const existing = document.getElementById('lockdown-clientid');
      if (existing) existing.remove();
      const style = `
        position: fixed;
        bottom: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.6);
        color: white;
        padding: 6px 12px;
        border-radius: 6px;
        font-family: sans-serif;
        font-size: 14px;
        z-index: 9999;
        pointer-events: none;
        display: inline-block;
        max-width: fit-content;
        white-space: nowrap;
        margin: 0;
      `;
      const div = document.createElement('div');
      div.textContent = `ID: ${clientId}`;
      div.setAttribute('style', style);
      div.id = 'lockdown-clientid';
      document.body.appendChild(div);
    } catch(e) {}
  },
  showStatusBanner: (message, type = 'error') => {
    try {
      let color = 'red';
      if (type === 'info') color = '#007bff';
      if (type === 'success') color = '#28a745';
      if (type === 'warning') color = '#ffc107';
      let banner = document.getElementById('lockdown-status-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'lockdown-status-banner';
        document.body.appendChild(banner);
      }
      banner.textContent = message;
      banner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        background: ${color};
        color: white;
        text-align: center;
        padding: 10px;
        font-family: sans-serif;
        font-size: 15px;
        z-index: 10000;
        box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        margin: 0;
        display: block;
      `;
    } catch(e) {}
  },
  hideStatusBanner: () => {
    try {
      const banner = document.getElementById('lockdown-status-banner');
      if (banner) banner.style.display = 'none';
    } catch(e){}
  }
});