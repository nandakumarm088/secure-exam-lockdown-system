// adminApp\main.js

const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Always start with login.html — login.js handles redirect if already logged in
  win.loadFile(path.join(__dirname, 'pages', 'login.html'));
}

app.whenReady().then(createWindow);
