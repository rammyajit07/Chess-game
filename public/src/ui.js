export function $(sel, root = document) {
  return root.querySelector(sel);
}
export function $all(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

export function formatClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function showModal({ title, bodyEl, actions }) {
  const modal = $("#modal");
  const modalTitle = $("#modalTitle");
  const modalBody = $("#modalBody");
  const modalActions = $("#modalActions");
  modalTitle.textContent = title;
  modalBody.innerHTML = "";
  modalBody.appendChild(bodyEl);
  modalActions.innerHTML = "";
  for (const a of actions) modalActions.appendChild(a);
  modal.classList.remove("hidden");
  return () => modal.classList.add("hidden");
}

export function button(label, { className = "btn", onClick } = {}) {
  const b = document.createElement("button");
  b.className = className;
  b.textContent = label;
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

export async function shareText({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

