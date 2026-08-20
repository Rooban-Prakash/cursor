const invoke = window.__TAURI__.core.invoke;
const openPath = window.__TAURI__.opener?.openPath;
const revealItemInDir = window.__TAURI__.opener?.revealItemInDir;

const state = {
  activeTab: "quick-access",
  selectedPath: null,
  selectedName: null,
  desktopData: null,
  previewData: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const ICONS = {
  folder: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`,
  file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  location: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`,
};

const LOCATION_ICONS = {
  desktop: "🖥️",
  documents: "📄",
  downloads: "⬇️",
  pictures: "🖼️",
  music: "🎵",
  videos: "🎬",
  home: "🏠",
};

function formatSize(bytes) {
  if (bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return unit === 0 ? `${bytes} B` : `${size.toFixed(1)} ${units[unit]}`;
}

function setStatus(text) {
  $("#status-text").textContent = text;
}

function setSelectionInfo(text) {
  $("#selection-info").textContent = text || "";
}

function switchTab(tabId) {
  state.activeTab = tabId;
  $$(".tab").forEach((t) => {
    const isActive = t.dataset.tab === tabId;
    t.classList.toggle("active", isActive);
    t.setAttribute("aria-selected", isActive);
  });
  $$(".panel").forEach((p) => {
    p.classList.toggle("active", p.id === `panel-${tabId}`);
  });
}

async function selectItem(path, name) {
  state.selectedPath = path;
  state.selectedName = name;
  setSelectionInfo(name);
  $("#tab-preview").classList.add("has-selection");

  $$(".file-item.selected").forEach((el) => el.classList.remove("selected"));
  $$(`.file-item[data-path="${CSS.escape(path)}"]`).forEach((el) =>
    el.classList.add("selected")
  );

  await loadPreview(path);
}

async function loadPreview(path) {
  try {
    const data = await invoke("get_preview", { path });
    state.previewData = data;
    renderPreview(data);
  } catch (err) {
    setStatus(`Preview error: ${err}`);
  }
}

function renderPreview(data) {
  $("#preview-empty").classList.add("hidden");
  const content = $("#preview-content");
  content.classList.remove("hidden");

  const iconEl = $("#preview-icon");
  iconEl.className = `preview-icon ${data.is_dir ? "folder" : "file"}`;
  iconEl.innerHTML = data.is_dir ? ICONS.folder : ICONS.file;

  $("#preview-name").textContent = data.name;
  $("#preview-path").textContent = data.path;
  $("#preview-type").textContent = data.is_dir
    ? "Folder"
    : data.extension
    ? `.${data.extension} file`
    : "File";
  $("#preview-size").textContent = data.size;
  $("#preview-modified").textContent = data.modified;

  const textEl = $("#preview-text");
  const childrenEl = $("#preview-children");
  const bodyTitle = $("#preview-body-title");

  if (data.is_dir) {
    bodyTitle.textContent = `Contents (${data.children.length})`;
    textEl.classList.add("hidden");
    childrenEl.classList.remove("hidden");
    childrenEl.innerHTML = "";
    if (data.children.length === 0) {
      childrenEl.innerHTML = `<li class="empty-state"><p>This folder is empty</p></li>`;
    } else {
      data.children.forEach((entry) => {
        childrenEl.appendChild(createFileItem(entry, { compact: true }));
      });
    }
  } else {
    bodyTitle.textContent = "Preview";
    childrenEl.classList.add("hidden");
    textEl.classList.remove("hidden");
    textEl.textContent = data.content;
  }
}

function createFileItem(entry, opts = {}) {
  const li = document.createElement("li");
  li.className = "file-item";
  li.dataset.path = entry.path;
  li.dataset.name = entry.name;
  li.dataset.isDir = entry.is_dir;

  const iconType = entry.is_dir ? "folder" : "file";
  const meta = entry.is_dir
    ? "Folder"
    : `${formatSize(entry.size)}${entry.extension ? ` · .${entry.extension}` : ""} · ${entry.modified}`;

  li.innerHTML = `
    <div class="file-item-icon ${iconType}">${ICONS[iconType]}</div>
    <div class="file-item-info">
      <div class="file-item-name">${escapeHtml(entry.name)}</div>
      <div class="file-item-meta">${escapeHtml(meta)}</div>
    </div>
    <div class="file-item-action">${ICONS.chevron}</div>
  `;

  li.addEventListener("click", () => selectItem(entry.path, entry.name));
  li.addEventListener("dblclick", () => openItem(entry.path));

  return li;
}

function createLocationItem(item) {
  const li = document.createElement("li");
  li.className = "file-item";
  li.dataset.path = item.path;
  li.dataset.name = item.name;

  const emoji = LOCATION_ICONS[item.icon] || "📁";
  const meta = `${item.file_count} files · ${item.folder_count} folders`;

  li.innerHTML = `
    <div class="file-item-icon location">${emoji}</div>
    <div class="file-item-info">
      <div class="file-item-name">${escapeHtml(item.name)}</div>
      <div class="file-item-meta">${meta}</div>
    </div>
    <div class="file-item-action">${ICONS.chevron}</div>
  `;

  li.addEventListener("click", () => selectItem(item.path, item.name));
  li.addEventListener("dblclick", () => browseLocation(item.path, item.name));

  return li;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderList(containerId, items, renderer) {
  const container = $(containerId);
  container.innerHTML = "";
  if (!items || items.length === 0) {
    container.innerHTML = `
      <li class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <p>Nothing here yet</p>
      </li>`;
    return;
  }
  items.forEach((item) => container.appendChild(renderer(item)));
}

async function loadQuickAccess() {
  setStatus("Loading quick access…");
  try {
    const items = await invoke("get_quick_access");
    renderList("#quick-access-list", items, createLocationItem);
    setStatus(`Quick access · ${items.length} locations`);
  } catch (err) {
    setStatus(`Error: ${err}`);
  }
}

async function loadRecent() {
  setStatus("Loading recent files…");
  try {
    const files = await invoke("get_recent_files", { limit: 25 });
    renderList("#recent-list", files, (f) => createFileItem(f));
    setStatus(`Recent files · ${files.length} items`);
  } catch (err) {
    setStatus(`Error: ${err}`);
  }
}

async function loadDesktop() {
  setStatus("Loading desktop…");
  try {
    const data = await invoke("get_desktop_contents");
    state.desktopData = data;

    const label = `Desktop — ${data.file_count} files · ${data.folder_count} folders`;
    $("#desktop-tab-label").textContent = label;
    $("#desktop-path-label").textContent = data.path;
    renderList("#desktop-list", data.files, (f) => createFileItem(f));
    setStatus(label);
  } catch (err) {
    setStatus(`Error: ${err}`);
  }
}

async function browseLocation(path, name) {
  setStatus(`Opening ${name}…`);
  try {
    const data = await invoke("browse_directory", { path });
    state.desktopData = data;
    $("#desktop-path-label").textContent = data.path;
    renderList("#desktop-list", data.files, (f) => createFileItem(f));
    switchTab("desktop");
    setStatus(`${name} · ${data.file_count} files · ${data.folder_count} folders`);
  } catch (err) {
    setStatus(`Error: ${err}`);
  }
}

async function openItem(path) {
  try {
    await openPath(path);
  } catch (err) {
    setStatus(`Could not open: ${err}`);
  }
}

async function showInFolder(path) {
  try {
    await revealItemInDir(path);
  } catch (err) {
    setStatus(`Could not open folder: ${err}`);
  }
}

async function refreshAll() {
  const btn = $("#btn-refresh");
  btn.classList.add("spinning");
  await Promise.all([loadQuickAccess(), loadRecent(), loadDesktop()]);
  if (state.selectedPath) await loadPreview(state.selectedPath);
  setTimeout(() => btn.classList.remove("spinning"), 600);
}

function initTabs() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      switchTab(tab.dataset.tab);
      if (tab.dataset.tab === "preview" && state.selectedPath && !state.previewData) {
        loadPreview(state.selectedPath);
      }
    });
  });
}

function initActions() {
  $("#btn-refresh").addEventListener("click", refreshAll);

  $("#btn-open-desktop").addEventListener("click", async () => {
    if (state.desktopData?.path) await openPath(state.desktopData.path);
  });

  $("#btn-open-item").addEventListener("click", () => {
    if (state.previewData) {
      openItem(state.previewData.path);
    }
  });

  $("#btn-open-location").addEventListener("click", () => {
    if (state.previewData) {
      if (state.previewData.is_dir) {
        openItem(state.previewData.path);
      } else {
        showInFolder(state.previewData.path);
      }
    }
  });
}

async function init() {
  initTabs();
  initActions();
  await refreshAll();
}

document.addEventListener("DOMContentLoaded", init);
