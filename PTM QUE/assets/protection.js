// Blocks right-click and common dev-tool shortcuts (browser-level deterrent only, not real security)
document.addEventListener("contextmenu", (event) => event.preventDefault());

document.addEventListener("keydown", (event) => {
  // FIX: browser autofill fires keydown with no `key`, which used to throw an error
  const key = (event.key || "").toLowerCase();
  if (!key) return;

  if (key === "f12") event.preventDefault();                                   // F12
  if (event.ctrlKey && key === "u") event.preventDefault();                    // Ctrl+U
  if (event.ctrlKey && event.shiftKey && ["i", "j", "c"].includes(key)) {      // Ctrl+Shift+I / J / C
    event.preventDefault();
  }
});