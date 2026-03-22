// adminApp\renderer\clients.js

export async function loadClientViewLayout(view) {
  const container = document.getElementById("client-view-container");
  try {
    const res = await fetch(`tabs/views/${view}.html`);
    if (!res.ok) throw new Error("Failed to load view layout");
    const html = await res.text();
    container.innerHTML = html;

    // Dynamically load per-view CSS
    if (view === "all") {
      loadViewCSS('../assets/styles/all.css');
      const mod = await import('../renderer/allClients.js');
      mod.setupAllClientsTab();
    } 

    // else if (view === "labs") {
    //   loadViewCSS('../assets/styles/labs.css');
    //   const mod = await import('../renderer/labs.js');
    //   mod.setupLabClientsTab();
    // }

  } catch (err) {
    container.innerHTML = `<p style="color: red;">Error loading client view: ${view}</p>`;
    console.error(err);
  }
}


function loadViewCSS(href) {
  // Remove any previously injected view-style
  const oldViewStyle = document.getElementById('dynamic-view-css');
  if (oldViewStyle) oldViewStyle.remove();

  // Create new link
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.id = 'dynamic-view-css';
  document.head.appendChild(link);
}

export function setupClientTab() {
  // Inject CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '../assets/styles/clients.css';
  document.head.appendChild(link);

  const select = document.getElementById("view");

  select.addEventListener("change", () => {
    loadClientViewLayout(select.value);
  });

  // Initial load
  loadClientViewLayout(select.value || "all");
}
