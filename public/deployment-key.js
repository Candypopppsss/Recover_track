"use strict";

(() => {
  const field = document.getElementById("generated-key");
  const generateButton = document.getElementById("generate-key");
  const toggleButton = document.getElementById("toggle-key");
  const copyButton = document.getElementById("copy-key");
  const status = document.getElementById("key-status");
  const error = document.getElementById("key-error");

  function clearMessages() {
    status.textContent = "";
    error.textContent = "";
    error.hidden = true;
  }

  function clearKey() {
    field.value = "";
    field.type = "password";
    toggleButton.textContent = "Show key";
    toggleButton.disabled = true;
    copyButton.disabled = true;
    clearMessages();
  }

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
  }

  generateButton.addEventListener("click", () => {
    clearKey();
    if (!globalThis.isSecureContext || !globalThis.crypto?.getRandomValues) {
      showError(
        "Open this page over HTTPS in a current browser to generate a key.",
      );
      return;
    }
    const bytes = new Uint8Array(32);
    try {
      crypto.getRandomValues(bytes);
      field.value = btoa(String.fromCharCode(...bytes));
      toggleButton.disabled = false;
      copyButton.disabled = false;
      status.textContent =
        "Key generated locally. Copy it and save a private backup before leaving this page.";
    } catch {
      clearKey();
      showError(
        "This browser could not generate a key. Try a current browser over HTTPS.",
      );
    } finally {
      bytes.fill(0);
    }
  });

  toggleButton.addEventListener("click", () => {
    if (!field.value) return;
    const show = field.type === "password";
    field.type = show ? "text" : "password";
    toggleButton.textContent = show ? "Hide key" : "Show key";
  });

  copyButton.addEventListener("click", async () => {
    if (!field.value) return;
    clearMessages();
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(field.value);
      status.textContent =
        "Copied. Paste it into DATA_ENCRYPTION_KEY in Vercel, then save a private backup.";
    } catch {
      showError(
        "Clipboard access is unavailable. Choose Show key, then select and copy it manually. Keep it private.",
      );
      field.focus();
      field.select();
    }
  });

  window.addEventListener("pagehide", clearKey);
  clearKey();
})();
