// clientApp\pinModalTemplate.js

function getPinModalHTML() {
  return `
    <style>
      html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; background: #fbfcfd; }
      body {
        min-height: 200px;
        width: 100vw;
        height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;  /* add this */
        padding-top: 10px; 
        font-family: sans-serif;
      }
      h3 { font-size: 1.08em; font-weight: 500; margin: 0 0 12px 0; text-align: center; width: 100%; }
      form {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 230px;
        max-width: 96vw;
        text-align: center;
      }
      input {
        font-size: 1em;
        padding: 5px 9px;
        border-radius: 5px;
        border: 1px solid #c3c6ca;
        width: 120px;
        background: #fff;
        text-align: center;
        margin-bottom: 3px;
      }
      .errmsg {
        margin: 3px 0 0 0;
        color: #b3252a;
        font-size: 0.97em;
        font-weight: 500;
        text-align: center;
        display: none;
      }
      .errmsg.visible { display: block; }
      .btns {
        margin-top: 5px;
        width: 100%;
        display: flex;
        flex-direction: row;
        justify-content: center;
        gap: 10px;
      }
      button {
        font-size: 0.97em;
        padding: 4px 16px;
        border-radius: 4px;
        border: none;
        background: #2780e3;
        color: #fff;
        cursor: pointer;
      }
      button:hover { background: #105195; }
    </style>
    <body>
      <h3>Enter PIN to continue</h3>
      <form id="form" autocomplete="off">
        <input id="pin" type="password" maxlength="10" autofocus autocomplete="off"/>
        <div id="errMsg" class="errmsg"></div>
        <div class="btns">
          <button type="submit">OK</button>
          <button type="button" id="cancel">Cancel</button>
        </div>
      </form>
      <script>
      try {
        const { ipcRenderer } = require('electron');
        const pinInput = document.getElementById('pin');
        const errMsg = document.getElementById('errMsg');
        function showError(msg) {
          if (msg) { errMsg.textContent = msg; errMsg.classList.add('visible'); }
          else     { errMsg.textContent = ''; errMsg.classList.remove('visible'); }
        }
        function closeModal() {
          ipcRenderer.send('pin-modal-result', null);
        }
        document.getElementById('form').onsubmit = async function(e) {
          e.preventDefault();
          const pin = pinInput.value.trim();
          if (!/^\\d{4,10}$/.test(pin)) {
            showError('PIN must be 4-10 digits.');
            pinInput.focus();
            return;
          }
          showError('');
          try {
            const ok = await ipcRenderer.invoke('verify-pin', pin);
            if (!ok) {
              showError('Incorrect PIN.');
              pinInput.select();
              return;
            }
            ipcRenderer.send('pin-modal-result', pin);
          } catch(err) {
            showError('Error checking PIN. Try again.');
          }
        };
        pinInput.oninput = () => { showError(''); };
        document.getElementById('cancel').onclick = closeModal;
        window.addEventListener('keydown', function(e) {
          if (e.key === 'Escape' || e.keyCode === 27) {
            e.preventDefault();
            closeModal();
          }
        });
      } catch (err) {
        // Critical fallback: auto-close
        try { ipcRenderer.send('pin-modal-result', null); } catch(_){}
      }
      </script>
    </body>
  `;
}
module.exports = { getPinModalHTML };
