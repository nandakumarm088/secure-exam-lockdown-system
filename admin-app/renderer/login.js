// adminApp/renderer/login.js
import { SERVER_URL } from './config.js';
import { setCurrentUser } from '../state.js';

window.onload = () => {
  document.getElementById('loginBtn').addEventListener('click', login);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') login();
  });
};

async function login() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  const status = document.getElementById('status');
  const spinner = document.getElementById('spinner');

  status.textContent = '';
  if (!username || !password) {
    status.textContent = '⚠️ Please enter both username and password.';
    return;
  }

  spinner.style.display = 'inline';

  try {
    const response = await fetch(`${SERVER_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    spinner.style.display = 'none';

    if (data.success) {
      setCurrentUser({ username: data.username, role: data.role });
      localStorage.setItem('token', data.token);

      localStorage.removeItem('selectedTab');

      window.location = data.role === 'super_admin' ? 'super-dashboard.html' : 'admin-dashboard.html';
    } else {
      status.textContent = '❌ ' + data.message;
      document.getElementById('password').value = '';
    }
  } catch (err) {
    spinner.style.display = 'none';
    console.error(err);
    status.textContent = '❌ Unable to connect to server.';
  }
}
