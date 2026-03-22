// adminApp/renderer/superDashboard.js
import { connectWebSocket } from './websocketManager.js';
connectWebSocket();

import { getCurrentUser, setCurrentUser } from '../state.js';

// Select all tabs and the content container
const tabs = document.querySelectorAll('.tab');
const contentArea = document.getElementById('tab-content');

// Function to show the current user name and role
function updateUserDisplay() {
  const userSpan = document.getElementById('user-display');
  const user = getCurrentUser();
  if (user && user.username) {
    let rolePretty = '';
    if (user.role === 'super_admin') rolePretty = 'Super Admin';
    else if (user.role === 'admin') rolePretty = 'Admin';
    else rolePretty = '';
    userSpan.textContent = `${user.username}${rolePretty ? ` (${rolePretty})` : ''}`;
  } else {
    userSpan.textContent = 'Unknown';
  }
}

function loadTabCSS(href) {
  // Remove previously injected tab-style
  const oldTabStyle = document.getElementById('dynamic-tab-css');
  if (oldTabStyle) oldTabStyle.remove();

  // Create link
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.id = 'dynamic-tab-css';

  // Append to <head>
  document.head.appendChild(link);
}

function adjustTabContentMargin() {
  const header = document.getElementById('main-header');
  const tabsEl = document.getElementById('main-tabs');
  const tabContent = document.getElementById('tab-content');
  const headerHeight = header ? header.offsetHeight : 0;
  const tabsHeight = tabsEl ? tabsEl.offsetHeight : 0;
  const topOffset = headerHeight + tabsHeight;
  tabContent.style.marginTop = topOffset + 'px';
  tabContent.style.height = `calc(100vh - ${topOffset}px)`;
}

// Call on DOM load and window resize
window.addEventListener('DOMContentLoaded', adjustTabContentMargin);
window.addEventListener('resize', adjustTabContentMargin);

// Function to load tab HTML dynamically
async function loadTab(tabName) {
  try {
    const response = await fetch(`tabs/${tabName}.html`);
    if (!response.ok) throw new Error(`Failed to load ${tabName}.html`);
    const html = await response.text();
    contentArea.innerHTML = html;

    // Load tab-specific CSS and JS
    if (tabName === "clients") {
      loadTabCSS('../assets/styles/clients.css');
      const mod = await import('./clients.js');
      mod.setupClientTab();
    } else if (tabName === "exam") {
      loadTabCSS('../assets/styles/exam.css');
      const mod = await import('./exam.js');
      mod.setupExamTab();
    } else if (tabName === "admin") {
      loadTabCSS('../assets/styles/admin.css');
      const mod = await import('./admin.js');
      mod.setupAdminTab();
    }
  } catch (err) {
    contentArea.innerHTML = `<div class="error">Error loading content for "${tabName}".</div>`;
    console.error(err);
  }
}

// Attach click event to each tab
tabs.forEach(tab => {
  tab.addEventListener('click', (e) => {
    e.preventDefault();

    // Set active tab styling
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Get the tab name and load content
    const tabName = tab.getAttribute('data-tab');
    loadTab(tabName);

    // Save selected tab to localStorage
    localStorage.setItem('selectedTab', tabName);
  });
});

// Load the default tab and set up user display and logout
window.addEventListener('DOMContentLoaded', () => {
  // Show user info at top
  updateUserDisplay();

  // Restore last selected tab or default to 'clients'
  const lastTab = localStorage.getItem('selectedTab') || 'clients';
  const targetTab = Array.from(document.querySelectorAll('.tab'))
    .find(tab => tab.getAttribute('data-tab') === lastTab);

  if (targetTab) {
    // Mark as active
    tabs.forEach(t => t.classList.remove('active'));
    targetTab.classList.add('active');
    // Load content
    loadTab(lastTab);
  }

  // Modal logout logic
  const logoutBtn    = document.querySelector('.logout-btn');
  const logoutModal  = document.getElementById('logout-modal');
  const modalBox     = logoutModal.querySelector('.modal-box');
  const confirmBtn   = document.getElementById('confirm-logout');
  const cancelBtn    = document.getElementById('cancel-logout');

  // Show modal
  logoutBtn.addEventListener('click', () => {
    logoutModal.classList.add('active');
    modalBox.focus();
  });

  // Hide modal function
  function closeModal() {
    logoutModal.classList.remove('active');
  }

  // Confirm logout
  confirmBtn.addEventListener('click', () => {
    closeModal();
    localStorage.removeItem('token');
    setCurrentUser();
    window.location.replace('login.html');
  });

  // Cancel/logout close
  cancelBtn.addEventListener('click', closeModal);

  // Click outside modal box closes modal
  logoutModal.addEventListener('mousedown', e => {
    if (e.target === logoutModal) closeModal();
  });

  // ESC key closes modal
  window.addEventListener('keydown', e => {
    if (logoutModal.classList.contains('active') && e.key === 'Escape') {
      closeModal();
    }
  });

});
