// adminApp\renderer\admin.js

import { SERVER_URL } from './config.js';
import { getCurrentUser } from '../state.js';

export function setupAdminTab() {
  let adminList = [];
  const adminTable = document.getElementById("adminTable").querySelector("tbody");
  const superTable = document.getElementById("superAdminTable").querySelector("tbody");
  const searchInput = document.getElementById("adminSearch");
  const status = document.getElementById("admin-status");
  const resetModal = document.getElementById("resetModal");
  const passwordInput = document.getElementById("superPassword");
  const toastDiv = document.getElementById("toaster");
  const addUserNameInput = document.getElementById("adminUsername");
  const addUserEmailInput = document.getElementById("adminEmail");
  const addUserRoleInput = document.getElementById("adminRole");
  const addAdminBtn = document.getElementById("addAdminBtn");
  const addAdminSpinner = addAdminBtn.querySelector(".add-spinner");
  const addAdminLabel = addAdminBtn.querySelector(".add-label");
  let resetTarget = null;

  [addUserNameInput, addUserEmailInput, addUserRoleInput].forEach(input => {
    input.addEventListener("input", () => removeFieldError(input));
    input.addEventListener("change", () => removeFieldError(input));
  });

  function showAddSpinner(isSpin = true) {
    if (isSpin) {
      addAdminBtn.disabled = true;
      addAdminSpinner.style.display = "";
      addAdminLabel.style.visibility = "hidden";
    } else {
      addAdminBtn.disabled = false;
      addAdminSpinner.style.display = "none";
      addAdminLabel.style.visibility = "";
    }
  }

  function showToast(message, type = 'info', duration = 3000) {
    // Always get a fresh reference to the toast container in case of dynamic DOM
    let container = document.getElementById('toastContainer');
    if (!container) {
      // Appends to tab-content only (never document.body)
      const tabContent = document.getElementById('tab-content');
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      if (tabContent) {
        tabContent.appendChild(container);
      } else {
        // Last-resort fallback, if no tab-content (shouldn't happen)
        document.body.appendChild(container);
      }
    }
    const MAX_TOASTS = 5;
    const existingToasts = container.querySelectorAll('.toast');
    if (existingToasts.length >= MAX_TOASTS) {
      for (let i = 0; i < (existingToasts.length - MAX_TOASTS + 1); i++) {
        existingToasts[i].remove();
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
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }


  function setFieldError(input, msg) {
    removeFieldError(input);
    if (!msg) return;
    const span = document.createElement('span');
    span.className = "field-error";
    span.textContent = msg;
    input.parentNode.appendChild(span);
    input.classList.add("input-error");
  }
  function removeFieldError(input) {
    input.classList.remove("input-error");
    const err = input.parentNode.querySelector('.field-error');
    if (err) err.remove();
  }

  function setStatus(msg, ok = true) {
    status.textContent = msg;
    status.style.color = ok ? "green" : "red";
    status.style.display = msg ? "" : "none";
  }
  function setAddAdminGenericError(msg) {
    const errDiv = document.getElementById("addAdminError");
    errDiv.textContent = msg || "";
    errDiv.style.display = msg ? "" : "none";
  }

  function verifyPasswordModal(promptMsg = "Confirm Password") {
    return new Promise((resolve) => {
      resetModal.querySelector('h3').textContent = promptMsg;
      resetModal.classList.remove("hidden");
      removeFieldError(passwordInput);
      passwordInput.value = "";
      passwordInput.focus();
      document.getElementById("confirmResetBtn").onclick = null;
      document.getElementById("cancelResetBtn").onclick = null;

      function cleanup() {
        resetModal.classList.add("hidden");
        passwordInput.value = "";
        removeFieldError(passwordInput);
        document.getElementById("confirmResetBtn").onclick = null;
        document.getElementById("cancelResetBtn").onclick = null;
        document.removeEventListener("keydown", escHandler);
        resetModal.removeEventListener("mousedown", overlayHandler);
        passwordInput.removeEventListener("input", onFieldInputRemoveErr);
      }
      async function handleConfirm() {
        removeFieldError(passwordInput);
        const entered = passwordInput.value.trim();
        if (!entered) {
          setFieldError(passwordInput, "Password is required.");
          passwordInput.focus();
          return;
        }
        const ok = await verifyPassword(entered);
        if (!ok) {
          setFieldError(passwordInput, "Incorrect password.");
          passwordInput.value = "";
          passwordInput.focus();
          return;
        }
        cleanup();
        resolve(true);
      }
      function handleCancel() { cleanup(); resolve(false); }
      function escHandler(evt) {
        if (
          !resetModal.classList.contains("hidden") &&
          (evt.key === "Escape" || evt.key === "Esc")
        ) { cleanup(); resolve(false); }
      }
      function overlayHandler(e) { if (e.target === resetModal) { cleanup(); resolve(false); } }
      function onFieldInputRemoveErr() { removeFieldError(passwordInput); }

      document.getElementById("confirmResetBtn").onclick = handleConfirm;
      document.getElementById("cancelResetBtn").onclick = handleCancel;
      document.addEventListener("keydown", escHandler);
      resetModal.addEventListener("mousedown", overlayHandler);
      passwordInput.addEventListener("input", onFieldInputRemoveErr);
    });
  }

  async function fetchAdminList() {
    setStatus("Loading admins...", true);
    try {
      const resp = await fetch(`${SERVER_URL}/api/admins`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      if (!resp.ok) {
        if (resp.status === 401 || resp.status === 403) {
          setStatus("Session expired. Please login again.", false);
        } else {
          setStatus("Failed to fetch admin list (" + resp.status + ")", false);
        }
        adminList = [];
        renderTable();
        return;
      }
      adminList = await resp.json();
      setStatus("");
      renderTable();
    } catch (err) {
      setStatus("Could not load admins: " + err.message, false);
      adminList = [];
      renderTable();
    }
  }

  async function tryExtractMsg(resp, fallback) {
    try { const data = await resp.json(); return data?.message || fallback; }
    catch { return fallback; }
  }

  // --- Render Row, Editing, and Actions for both Admin and SuperAdmin ---
  function renderAdminRow(admin, currentUser, parentTable) {
    const isCurrentUser = admin.username === currentUser.username;
    const tr = document.createElement("tr");
    if (isCurrentUser) tr.classList.add("highlight-current-user");

    if (admin.isEditing) {
      tr.classList.add("editing-row");
      tr.innerHTML = `
        <td><input type="text" class="edit-username" value="${admin.username}" autocomplete="off"/></td>
        <td><input type="email" class="edit-email" value="${admin.email}" autocomplete="off"/></td>
        <td class="btn-group">
          <button class="cancel-btn">Cancel</button>
          <button class="save-btn">Save</button>
          ${!isCurrentUser ? `<button class="remove-btn">Remove</button>` : ""}
        </td>
      `;
      tr.querySelectorAll("input").forEach(input => {
        input.addEventListener("input", () => {
          const btnGroup = tr.querySelector('.btn-group');
          const fieldError = btnGroup?.querySelector('.field-error');
          if (fieldError) fieldError.remove();
        });
      });

      parentTable.appendChild(tr);

      function closeEditMode() {
        adminList.forEach(a => delete a.isEditing);
        renderTable();
        document.removeEventListener('mousedown', outsideClickHandler, true);
        document.removeEventListener('keydown', escHandler, true);

        searchInput.removeEventListener("input", closeEditMode);
        addUserNameInput.removeEventListener('focus', closeEditMode);
        addUserEmailInput.removeEventListener('focus', closeEditMode);
        addUserRoleInput.removeEventListener('focus', closeEditMode);
      }

      function outsideClickHandler(e) {
        if (!tr.contains(e.target)) {
          closeEditMode();
        }
      }

      function escHandler(e) {
        if ((e.key === "Escape" || e.key === "Esc") && !resetModal.classList.contains("hidden")) return;
        if (e.key === "Escape" || e.key === "Esc") {
          closeEditMode();
        }
      }

      document.addEventListener('mousedown', outsideClickHandler, true);
      document.addEventListener('keydown', escHandler, true);
      searchInput.addEventListener("input", closeEditMode);
      addUserNameInput.addEventListener('focus', closeEditMode);
      addUserEmailInput.addEventListener('focus', closeEditMode);
      addUserRoleInput.addEventListener('focus', closeEditMode);
      
      tr.querySelector(".cancel-btn")?.addEventListener("click", closeEditMode);

      tr.querySelector(".save-btn")?.addEventListener("click", async () => {
        const newUsername = tr.querySelector(".edit-username").value.trim();
        const newEmail = tr.querySelector(".edit-email").value.trim();
        removeFieldError(tr.querySelector('.edit-username'));
        removeFieldError(tr.querySelector('.edit-email'));

        if (
          newUsername === admin.username &&
          newEmail === admin.email
        ) {
          let btnGroup = tr.querySelector('.btn-group');
          if (btnGroup && !btnGroup.querySelector('.field-error')) {
            const span = document.createElement('span');
            span.className = "field-error";
            span.textContent = "No changes to save.";
            btnGroup.appendChild(span);
          }
          setTimeout(() => {
            if (btnGroup) {
              const error = btnGroup.querySelector('.field-error');
              if (error) error.remove();
            }
          }, 1500);
          return;
        }

        if (!newUsername) return setFieldError(tr.querySelector('.edit-username'), "Username required.");
        if (!newEmail) return setFieldError(tr.querySelector('.edit-email'), "Email required.");
        if (!/^\S+@\S+\.\S+$/.test(newEmail)) return setFieldError(tr.querySelector('.edit-email'), "Invalid email address.");

        // === 1. Server duplicate/validation check FIRST ===
        try {
          const resp = await fetch(`${SERVER_URL}/api/admins/validate`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
            body: JSON.stringify({
              username: newUsername,
              email: newEmail,
              currentUsername: admin.username  // Very important
            })
          });
          if (!resp.ok) {
            const errMsg = await tryExtractMsg(resp, "Validation error");
            if (/username.*exist/i.test(errMsg) || /username.*taken/i.test(errMsg))
              return setFieldError(tr.querySelector('.edit-username'), "Username already exists.");
            if (
              /email.*exist/i.test(errMsg) ||
              /email.*taken/i.test(errMsg) ||
              /email.*in use/i.test(errMsg) ||
              /already in use/i.test(errMsg)
            )
              return setFieldError(tr.querySelector('.edit-email'), "Email already in use.");
            showToast(errMsg, false);
            setStatus(`[${resp.status}] ${errMsg}`, false);
            return;
          }
        } catch (err) {
          showToast("Network error validating changes.", false);
          setStatus("Network error during admin update validation.", false);
          return;
        }

        // === 2. PASSWORD MODAL, only if validation passed ===
        const confirmed = await verifyPasswordModal("Confirm your password to edit this account");
        if (!confirmed) return;

        setStatus("Updating admin...", true);

        // === 3. Update user ===
        try {
          const resp = await fetch(`${SERVER_URL}/api/admins/${encodeURIComponent(admin.username)}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
            body: JSON.stringify({ username: newUsername, email: newEmail })
          });
          if (!resp.ok) {
            const errMsg = await tryExtractMsg(resp, "Failed to update admin");
            if (/username.*exist/i.test(errMsg) || /username.*taken/i.test(errMsg))
              setFieldError(tr.querySelector('.edit-username'), "Username already exists.");
            else if (
              /email.*exist/i.test(errMsg) ||
              /email.*taken/i.test(errMsg) ||
              /email.*in use/i.test(errMsg) ||
              /already in use/i.test(errMsg)
            )
              setFieldError(tr.querySelector('.edit-email'), "Email already in use.");
            setStatus(errMsg, false); showToast(errMsg, false); return;
          }
          showToast("Admin updated.");
          setStatus("Admin updated.", true);
          await fetchAdminList();
        } catch (err) {
          showToast("Error updating admin: " + err.message, false);
          setStatus("Error updating admin: " + err.message, false);
        }
      });

      if (!isCurrentUser) {
        tr.querySelector(".remove-btn")?.addEventListener("click", async () => {
          const confirmed = await verifyPasswordModal("Password required to remove this admin.");
          if (!confirmed) return;
          setStatus("Removing admin...", true);
          try {
            const resp = await fetch(`${SERVER_URL}/api/admins/${encodeURIComponent(admin.username)}`, {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${localStorage.getItem("token")}`,
              }
            });
            if (!resp.ok) {
              const errMsg = await tryExtractMsg(resp, "Failed to remove admin");
              setStatus(errMsg, false); showToast(errMsg, false); return;
            }
            setStatus(`${admin.username} removed.`, true);
            showToast(`Admin "${admin.username}" removed.`);
            await fetchAdminList();
          } catch (err) {
            setStatus("Error removing admin: " + err.message, false);
            showToast("Error removing admin: " + err.message, false);
          }
        });
      }
    } 
      
    else {
      tr.innerHTML = `
        <td><span class="username">${admin.username}</span></td>
        <td><span class="email">${admin.email}</span></td>
        <td class="btn-group">
          <button class="edit-btn">Edit</button>
          <button class="reset-btn">Reset Password</button>
        </td>
      `;
      parentTable.appendChild(tr);

      tr.querySelector(".edit-btn")?.addEventListener("click", () => {
        adminList.forEach(a => delete a.isEditing);
        admin.isEditing = true;
        renderTable();
        setTimeout(() => {
          const editField = tr.querySelector(".edit-username");
          if (editField) editField.focus();
        }, 0);
      });

      tr.querySelector(".reset-btn")?.addEventListener("click", async () => {
        // 1. Confirm password (same as before)
        const adminUsername = admin.username; // username to reset
        const adminEmail = admin.email;
        const confirmed = await verifyPasswordModal("Enter your password to send a password reset link");
        if (!confirmed) return;

        setStatus("Sending reset link...", true);
        try {
          // 2. Ask server to send email (reused endpoint)
          const resp = await fetch(`${SERVER_URL}/api/admins/${encodeURIComponent(adminUsername)}/request-reset-password`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            }
          });
          if (!resp.ok) {
            const errMsg = await tryExtractMsg(resp, "Failed to send reset link.");
            setStatus("Reset error: " + errMsg, false);
            showToast("Reset error: " + errMsg, false);
          } else {
            setStatus(`Reset link sent to ${adminEmail}`, true);
            showToast(`Reset link sent to ${adminEmail}`);
          }
        } catch (err) {
          setStatus("Reset error: " + err.message, false);
          showToast("Reset error: " + err.message, false);
        }
      });

    }
  }

  function renderTable() {
    const currentUser = getCurrentUser() || {};
    adminTable.innerHTML = "";
    superTable.innerHTML = "";
    const term = searchInput.value.trim().toLowerCase() || "";

    // Move current user to top of superadmins
    let supers = adminList.filter(a => a.role === "super_admin");
    let others = adminList.filter(a => a.role !== "super_admin");

    // Find current user index
    let curIdx = supers.findIndex(a => a.username === currentUser.username);
    if (curIdx > -1) {
      supers.unshift(supers.splice(curIdx, 1)[0]);
    }

    supers.forEach(admin => {
      if (
        term &&
        !admin.username.toLowerCase().includes(term) &&
        !admin.email.toLowerCase().includes(term)
      ) return;
      renderAdminRow(admin, currentUser, superTable);
    });

    others.forEach(admin => {
      if (
        term &&
        !admin.username.toLowerCase().includes(term) &&
        !admin.email.toLowerCase().includes(term)
      ) return;
      renderAdminRow(admin, currentUser, adminTable);
    });
  }

  async function verifyPassword(password) {
    if (!password) return false;
    try {
      const resp = await fetch(`${SERVER_URL}/api/login/verify-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`
        },
        body: JSON.stringify({ password })
      });
      if (!resp.ok) return false;
      const data = await resp.json();
      return !!data.valid;
    } catch (_) { return false; }
  }

  addAdminBtn.addEventListener("click", async () => {
    const username = addUserNameInput.value.trim();
    const email = addUserEmailInput.value.trim();
    const role = addUserRoleInput.value;

    removeFieldError(addUserNameInput);
    removeFieldError(addUserEmailInput);
    removeFieldError(addUserRoleInput);
    setAddAdminGenericError("");

    const emailRegex = /^\S+@\S+\.\S+$/;
    let missing = false;
    if (!username) { addUserNameInput.classList.add("input-error"); missing = true; }
    if (!email)    { addUserEmailInput.classList.add("input-error"); missing = true; }
    if (!role)     { addUserRoleInput.classList.add("input-error"); missing = true; }
    if (email && !emailRegex.test(email)) addUserEmailInput.classList.add("input-error");

    if (missing) {
      setAddAdminGenericError("All fields must be filled out to add an admin.");
      return;
    }
    if (!emailRegex.test(email)) {
      setFieldError(addUserEmailInput, "Enter a valid email address.");
      addUserEmailInput.focus();
      return;
    }

    showAddSpinner(true);
    try {
      const resp = await fetch(`${SERVER_URL}/api/admins/validate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`
        },
        body: JSON.stringify({ username, email })
      });
      showAddSpinner(false);

      if (!resp.ok) {
        const errMsg = await tryExtractMsg(resp, "Failed to validate admin");
        if (/username.*exist/i.test(errMsg) || /username.*taken/i.test(errMsg))
          setFieldError(addUserNameInput, "Username already exists.");
        else if (
          /email.*exist/i.test(errMsg) ||
          /email.*taken/i.test(errMsg) ||
          /email.*in use/i.test(errMsg) ||
          /already in use/i.test(errMsg)
        )
          setFieldError(addUserEmailInput, "Email already in use.");
        showToast(errMsg, false);
        setStatus(`[${resp.status}] ${errMsg}`, false);
        return;
      }
    } catch (err) {
      showAddSpinner(false);
      showToast("Network error validating admin.", false);
      setStatus("Network error for server validation.", false);
      return;
    }

    const confirmed = await verifyPasswordModal("Confirm your password to add a new admin");
    if (!confirmed) return;

    showAddSpinner(true);
    setStatus("Adding admin...", true);

    try {
      const resp = await fetch(`${SERVER_URL}/api/admins`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`
        },
        body: JSON.stringify({ username, email, role })
      });
      showAddSpinner(false);

      if (!resp.ok) {
        const errMsg = await tryExtractMsg(resp, "Failed to add admin");
        if (/username.*exist/i.test(errMsg) || /username.*taken/i.test(errMsg))
          setFieldError(addUserNameInput, "Username already exists.");
        else if (
          /email.*exist/i.test(errMsg) ||
          /email.*taken/i.test(errMsg) ||
          /email.*in use/i.test(errMsg) ||
          /already in use/i.test(errMsg)
        )
          setFieldError(addUserEmailInput, "Email already in use.");
        showToast(errMsg, false);
        setStatus(`[${resp.status}] ${errMsg}`, false);
        return;
      }

      setStatus(`Admin "${username}" added. Email sent to set password.`, true);
      showToast(`Admin "${username}" added. Email sent to set password.`);
      addUserNameInput.value = "";
      addUserEmailInput.value = "";
      addUserRoleInput.value = "";
      setAddAdminGenericError("");
      await fetchAdminList();
    } catch (err) {
      showAddSpinner(false);
      setStatus((err && err.message) || "Could not add admin", false);
      showToast(err.message || "Could not add admin", false);
    }
  });

  function resetAddAdminForm() {
    addUserNameInput.value = "";
    addUserEmailInput.value = "";
    addUserRoleInput.value = "";
    removeFieldError(addUserNameInput);
    removeFieldError(addUserEmailInput);
    removeFieldError(addUserRoleInput);
  }

  document.getElementById("resetAdminFormBtn").addEventListener("click", () => {
    resetAddAdminForm();
    setAddAdminGenericError("");
  });

  searchInput.addEventListener("input", renderTable);
  fetchAdminList();
}