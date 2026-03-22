// setup-password.js
(function() {
  // Robust helpers
  function hideAll(msg) {
    document.body.innerHTML = `<h2 style='color:#c5392f;text-align:center;'>${msg || "404: This link is invalid or not available."}</h2>`;
  }
  function showStatus(msg, ok) {
    const status = document.getElementById('status');
    status.textContent = msg;
    status.className = (ok ? 'success' : '');
  }

  // Get link params (robust against repeated ? and &)
  const params = new URLSearchParams(window.location.search);
  const username = params.get('username');
  const token = params.get('token');
  const container = document.getElementById("container");
  const form = document.getElementById("setPasswordForm");

  if (!username || !token) { hideAll(); return; }

  let tokenValid = false; // Token validity flag (for robustness)

  // Validate link before showing UI
  async function preValidate() {
    showStatus("Validating link...", false);
    try {
      const resp = await fetch(`/api/admins/${encodeURIComponent(username)}/validate-setup-token?token=${encodeURIComponent(token)}`);
      const data = await resp.json();
      if (!resp.ok || !data.valid) {
        hideAll("This password link is invalid or has expired.");
        return;
      }
      tokenValid = true;
    } catch (e) {
      hideAll();
      return;
    }
    showStatus("", true);
    container.style.display = "";
    // Autofocus on first input
    const pwInput = document.getElementById("newPassword");
    if (pwInput) pwInput.focus();
  }
  document.addEventListener('DOMContentLoaded', preValidate);

  // Password show/hide toggle (ARIA and keyboard accessible)
  function addToggle(inputId, toggleId) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(toggleId);
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener('click', () => {
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      btn.setAttribute("aria-pressed", isHidden);
      btn.querySelector('.eye').style.display      = isHidden ? "none" : "";
      btn.querySelector('.eye-off').style.display = isHidden ? "" : "none";
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); btn.click();
      }
    });
    // Start as hidden
    btn.querySelector('.eye-off').style.display = "none";
  }
  addToggle("newPassword", "toggleNewPw");
  addToggle("confirmPassword", "toggleConfirmPw");

  // Password validation logic
  function validatePasswords(pw1, pw2) {
    // Optionally, use a stricter regex here
    if (typeof pw1 !== 'string' || pw1.length < 8)
      return "Password must be at least 8 characters.";
    // Uncomment for stricter security:
    // if (!/[A-Z]/.test(pw1) || !/[a-z]/.test(pw1) || !/[0-9]/.test(pw1))
    //   return "Password should include upper, lower case letters and numbers.";
    if (pw1 !== pw2)
      return "Passwords do not match.";
    return "";
  }

  // Submission handler
  let submitting = false;
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!tokenValid) {
      showStatus("This password link has expired or is invalid.", false);
      return;
    }
    if (submitting) return;
    submitting = true;

    showStatus("", false);

    const pw1 = document.getElementById('newPassword').value.trim();
    const pw2 = document.getElementById('confirmPassword').value.trim();
    const error = validatePasswords(pw1, pw2);
    if (error) {
      showStatus(error, false);
      submitting = false;
      return;
    }

    showStatus("Saving...", false);
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const resp = await fetch(`/api/admins/${encodeURIComponent(username)}/setup-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: pw1 })
      });
      const data = await resp.json();
      if (resp.ok) {
        showStatus(data.message || "Password set! You may now log in.", true);
        form.style.display = "none";
        tokenValid = false;
        setTimeout(() => {
          window.location.replace("/"); // Optionally redirect to login/home
        }, 3000);
      } else {
        // Specific errors
        if (data && /expired|token/i.test(data.message)) {
          showStatus("This password link is invalid or expired. Please request a new link.", false);
          container.style.display = "none";
          hideAll("This password link is invalid or expired. Please request a new one from your admin.");
        } else if (data.message) {
          showStatus(data.message, false);
        } else {
          showStatus("Failed to set password.", false);
        }
        button.disabled = false;
      }
    } catch (err) {
      showStatus("Network/server error. Please try again.", false);
      button.disabled = false;
    }
    submitting = false;
  });
})();
