// adminApp/renderer/exam.js
import { SERVER_URL } from './config.js';

let statusTimeout = null;

// Helper: Auto-complete to valid https:// URL (or return empty string if not valid-ish domain)
function completeToHttpsUrl(rawInput) {
  let url = rawInput.trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) {
    // Always convert to https
    url = url.replace(/^https?:\/\//i, 'https://');
  } else if (/^[\w.-]+\.[a-z]{2,}([:/?#].*)?$/i.test(url)) {
    // Looks like a domain w/optional path/query
    url = 'https://' + url;
  } else {
    // Not a valid domain-ish: return as-is for now; validation below will catch error
    url = url;
  }
  return url.trim();
}

export function setupExamTab() {
  const content = document.getElementById('tab-content');
  if (!content) return;

  // IDs as per your HTML in #tab-content
  const currentLinkEl = content.querySelector("#currentExamLink");
  const input         = content.querySelector("#examUrl");
  const updateBtn     = content.querySelector("#updateBtn");
  const resetBtn      = content.querySelector("#resetBtn");
  const saveStatus    = content.querySelector("#exam-save-status");
  const confirmModal  = content.querySelector("#confirmModal");
  const confirmYes    = content.querySelector("#confirmYes");
  const confirmNo     = content.querySelector("#confirmNo");
  const modalNewLink  = content.querySelector("#modalNewLink");

  let lastFetched = "";
  let updating    = false;

  // Safely remove previous listeners on reload
  function replaceNodeById(id) {
    const old = content.querySelector(`#${id}`);
    if (!old) return null;
    const newEl = old.cloneNode(true);
    old.parentNode.replaceChild(newEl, old);
    return newEl;
  }
  const updateBtn2    = replaceNodeById("updateBtn")     || updateBtn;
  const resetBtn2     = replaceNodeById("resetBtn")      || resetBtn;
  const confirmYes2   = replaceNodeById("confirmYes")    || confirmYes;
  const confirmNo2    = replaceNodeById("confirmNo")     || confirmNo;
  const input2        = replaceNodeById("examUrl")       || input;

  // Robust timeout-enabled status helper
  function showStatus(msg, type = "", duration = undefined) {
    if (!saveStatus) return;

    // Clear any previous timeout
    if (statusTimeout) {
      clearTimeout(statusTimeout);
      statusTimeout = null;
    }

    saveStatus.textContent = msg || "";
    saveStatus.className = "status-message";
    if (type) saveStatus.classList.add(type);

    // Only show message if a non-empty msg
    if (!msg) return;

    // Default durations: error 5s, success 3s, info 3s
    let visibleMs =
      typeof duration === "number" ? duration :
      (type === "error" ? 5000 : (type === "success" ? 3000 : 3000));

    statusTimeout = setTimeout(() => {
      saveStatus.textContent = "";
      saveStatus.className = "status-message";
      statusTimeout = null;
    }, visibleMs);
  }

  // Fetch current link from server on load
  async function fetchCurrentLink() {
    showStatus(""); // Clear any old status
    try {
      const res = await fetch(`${SERVER_URL}/api/exam-link`);
      const data = await res.json();
      lastFetched = data.link || "";
      if (currentLinkEl) currentLinkEl.textContent = lastFetched || "—";
      if (input2) input2.value = "";  // always blank input
    } catch (err) {
      if (currentLinkEl) currentLinkEl.textContent = "Unavailable";
      showStatus("Could not fetch current link.", "error");
    }
  }
  fetchCurrentLink();

  // Reset button: always blanks input
  resetBtn2?.addEventListener("click", (e) => {
    e.preventDefault();
    if (input2) input2.value = "";
    showStatus("");
    input2 && input2.focus();
  });

  function isValidHttpsUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && !!u.hostname && /\./.test(u.hostname);
    } catch {
      return false;
    }
  }

  // Update (modal/POST)
  updateBtn2?.addEventListener("click", (e) => {
    e.preventDefault();
    showStatus();

    let userInput = input2 ? input2.value.trim() : "";
    let completedLink = completeToHttpsUrl(userInput);

    if (!userInput) {
      showStatus("Please enter an exam link.", "error");
      input2 && input2.focus();
      return;
    }
    if (
      !isValidHttpsUrl(completedLink) || completedLink.length > 500
    ) {
      showStatus("Enter a valid exam URL (must start with https:// and a valid domain)", "error");
      input2 && input2.focus();
      return;
    }
    if (updating) return;
    if (completedLink === lastFetched) {
      showStatus("The link hasn't changed.", "error");
      return;
    }

    if (modalNewLink && confirmModal) {
      modalNewLink.textContent = completedLink;
      confirmModal.classList.remove("hidden");
      // Trap focus for modal accessibility (optional)
      confirmModal.querySelector("button")?.focus();
    }

    confirmYes2.onclick = async () => {
      confirmModal && confirmModal.classList.add("hidden");
      updating = true;
      showStatus("Updating...");
      try {
        const resp = await fetch(`${SERVER_URL}/api/exam-link`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(localStorage.getItem("token") && { Authorization: "Bearer " + localStorage.getItem("token") })
          },
          body: JSON.stringify({ link: completedLink })
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
          showStatus(data.message || "Failed to update link.", "error");
        } else {
          showStatus("Exam link updated.", "success");
          lastFetched = data.link;
          if (currentLinkEl) currentLinkEl.textContent = data.link;
          if (input2) input2.value = ""; // reset after successful update
          input2?.focus();
        }
      } catch (err) {
        showStatus("Server error. Try again!", "error");
      }
      updating = false;
    };

    confirmNo2.onclick = () => {
      confirmModal && confirmModal.classList.add("hidden");
      showStatus("Update cancelled.", "");
      input2?.focus();
    };
  });

  // Modal: ESC closes modal (accessibility improvement)
  confirmModal?.addEventListener('keydown', e => {
    if ((e.key === "Escape" || e.key === "Esc") && !confirmModal.classList.contains("hidden")) {
      confirmModal.classList.add("hidden");
      input2?.focus();
    }
  });

  // --- PIN SETUP LOGIC ---
  const pinInput        = content.querySelector("#adminPinInput");
  const updatePinBtn    = content.querySelector("#updatePinBtn");
  const clearPinBtn     = content.querySelector("#clearPinBtn");
  const pinSaveStatus   = content.querySelector("#pin-save-status");
  const pinModal        = content.querySelector("#pinConfirmModal");
  const pinConfirmYes   = content.querySelector("#pinConfirmYes");
  const pinConfirmNo    = content.querySelector("#pinConfirmNo");
  const modalNewPin     = content.querySelector("#modalNewPin");
  const togglePinBtn    = content.querySelector("#togglePinVisibility");

  let pinStatusTimeout = null;

  function showPinStatus(msg, type = "", duration) {
    if (!pinSaveStatus) return;
    if (pinStatusTimeout) clearTimeout(pinStatusTimeout);
    pinSaveStatus.textContent = msg || "";
    pinSaveStatus.className = "status-message";
    if (type) pinSaveStatus.classList.add(type);
    if (!msg) return;
    let t = typeof duration === "number" ? duration : (type === "error" ? 4800 : 2900);
    pinStatusTimeout = setTimeout(() => {
      pinSaveStatus.textContent = "";
      pinSaveStatus.className = "status-message";
      pinStatusTimeout = null;
    }, t);
  }

  // Plain validator (should match server logic)
  function isValidPin(pin) {
    if (!/^\d{4,10}$/.test(pin)) return false;
    // Reject common bad pins (0000, 1234, etc)
    const badPins = ["0000","1111","1234","4321","4444","7777","9999"];
    if (badPins.includes(pin)) return false;
    if (/^(\d)\1+$/.test(pin)) return false; // e.g. 5555
    return true;
  }

  clearPinBtn?.addEventListener("click", () => {
    if (pinInput) pinInput.value = "";
    showPinStatus("");
    pinInput?.focus();
  });

  togglePinBtn?.addEventListener("click", () => {
    if (!pinInput) return;
    if (pinInput.type === "password") {
      pinInput.type = "text";
      togglePinBtn.textContent = "Hide";
    } else {
      pinInput.type = "password";
      togglePinBtn.textContent = "Unhide";
    }
  });

  updatePinBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    showPinStatus("");
    const pin = pinInput?.value.trim();
    if (!pin) {
      showPinStatus("Please enter a PIN.", "error");
      pinInput?.focus();
      return;
    }
    if (!isValidPin(pin)) {
      showPinStatus("PIN must be 4-10 digits and not too simple.", "error");
      pinInput?.focus();
      return;
    }
    // Show masked pin in confirm modal
    if (modalNewPin && pinModal) {
      modalNewPin.textContent = pin;
      pinModal.classList.remove("hidden");
      pinConfirmYes?.focus();
    }
  });
  // Modal: Confirm Set PIN
  pinConfirmYes?.addEventListener("click", async () => {
    pinModal?.classList.add("hidden");
    const pin = pinInput?.value.trim();
    showPinStatus("Saving...", "", 4000);
    try {
      const token = localStorage.getItem("token");
      // Replace this route if needed; adjust clientId if multitenant
      const res = await fetch(`${SERVER_URL}/api/pin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {})
        },
        body: JSON.stringify({ pin })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showPinStatus(data.message || "Failed to set PIN.", "error");
      } else {
        showPinStatus("PIN updated!", "success");
        pinInput.value = "";
        pinInput.type = "password";
        togglePinBtn.textContent = "Unhide";
      }
    } catch {
      showPinStatus("Server error. Try again.", "error");
    }
  });
  pinConfirmNo?.addEventListener("click", () => {
    pinModal?.classList.add("hidden");
    showPinStatus("PIN update cancelled.", "");
    pinInput?.focus();
  });
  // ESC key closes PIN modal
  pinModal?.addEventListener('keydown', e => {
    if ((e.key === "Escape" || e.key === "Esc") && !pinModal.classList.contains("hidden")) {
      pinModal.classList.add("hidden");
      pinInput?.focus();
    }
  });

}
