// adminApp\renderer\adminDashboard.js

// Only Clients tab logic for admin
const tabs = document.querySelectorAll('.tab');
const contentArea = document.getElementById('tab-content');

// Load Clients tab only
async function loadClientsTab() {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('tabs/clients.html', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!response.ok) throw new Error('Failed to load clients.html');
    const html = await response.text();
    contentArea.innerHTML = html;

    const mod = await import('./clients.js');
    mod.setupClientTab();
  } catch (err) {
    contentArea.innerHTML = `<div class="error">Error loading Clients tab.</div>`;
    console.error(err);
  }
}

// Set tab listener (optional, for future expandability)
tabs.forEach(tab => {
  tab.addEventListener('click', (e) => {
    e.preventDefault();
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    loadClientsTab();
  });
});

// Load on page start and check for login
window.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location = 'login.html';
    return;
  }

  document.querySelector('.logout-btn').addEventListener('click', () => {
    localStorage.removeItem('token');
    window.location = 'login.html';
  });

  loadClientsTab();
});
