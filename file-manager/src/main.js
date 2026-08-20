const invoke = window.__TAURI__.core.invoke;
const openPath = window.__TAURI__.opener?.openPath;
const revealItemInDir = window.__TAURI__.opener?.revealItemInDir;
const pickFolder = window.__TAURI__.dialog?.open;

const STORAGE_KEY = "file-manager-prefs";

const ICONS = {
  folder: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`,
  file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`,
  remove: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1z"/></svg>`,
};

const LOCATION_ICONS = {
  desktop: "🖥️",
  documents: "📄",
  downloads: "⬇️",
  pictures: "🖼️",
  music: "🎵",
  videos: "🎬",
  home: "🏠",
  folder: "📁",
};

const state = {
  activeTab: "quick-access",
  selectedPath: null,
  selectedName: null,
  previewData: null,
  quickAccessPins: [],
  browse: {
    data: null,
    history: [],
    sortBy: "name",
    sortOrder: "asc",
    foldersFirst: true,
  },
  recent: {
    files: [],
    sortBy: "modified",
    sortOrder: "desc",
  },
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const prefs = JSON.parse(raw);
    if (prefs.browse) Object.assign(state.browse, prefs.browse);
    if (prefs.recent) Object.assign(state.recent, prefs.recent);
  } catch (_) {}
}

function savePrefs() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      browse: {
        sortBy: state.browse.sortBy,
        sortOrder: state.browse.sortOrder,
        foldersFirst: state.browse.foldersFirst,
      },
      recent: {
        sortBy: state.recent.sortBy,
        sortOrder: state.recent.sortOrder,
      },
    })
  );
}

function applyPrefsToUI() {
  $("#browse-sort-by").value = state.browse.sortBy;
  $("#browse-sort-order").value = state.browse.sortOrder;
  $("#browse-folders-first").checked = state.browse.foldersFirst;
  $("#recent-sort-by").value = state.recent.sortBy;
  $("#recent-sort-order").value = state.recent.sortOrder;
}

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

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function sortEntries(entries, { sortBy, sortOrder, foldersFirst = false }) {
  const sorted = [...entries].sort((a, b) => {
    if (foldersFirst && a.is_dir !== b.is_dir) {
      return a.is_dir ? -1 : 1;
    }

    let cmp = 0;
    switch (sortBy) {
      case "name":
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        break;
      case "type": {
        const ta = a.is_dir ? "folder" : (a.extension || "file").toLowerCase();
        const tb = b.is_dir ? "folder" : (b.extension || "file").toLowerCase();
        cmp = ta.localeCompare(tb);
        if (cmp === 0) cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        break;
      }
      case "size":
        cmp = (a.size || 0) - (b.size || 0);
        break;
      case "modified":
        cmp = (a.modified_ts || 0) - (b.modified_ts || 0);
        break;
      default:
        cmp = 0;
    }
    return sortOrder === "asc" ? cmp : -cmp;
  });
  return sorted;
}

function splitPath(path) {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (/^[A-Za-z]:/.test(normalized)) {
    parts[0] = parts[0] + "/";
  }
  return parts;
}

function joinPathParts(parts, index) {
  if (parts.length === 0) return "";
  if (index === 0 && /^[A-Za-z]:\/$/.test(parts[0])) {
    return parts[0].replace("/", "\\");
  }
  const slice = parts.slice(0, index + 1);
  if (/^[A-Za-z]:\/$/.test(slice[0])) {
    const drive = slice[0].replace("/", "");
    const rest = slice.slice(1);
    return rest.length ? `${drive}\\${rest.join("\\")}` : drive + "\\";
  }
  return slice.join("\\");
}

function renderBreadcrumbs(path) {
  const container = $("#breadcrumbs");
  container.innerHTML = "";
  const parts = splitPath(path);

  parts.forEach((part, index) => {
    if (index > 0) {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-sep";
      sep.textContent = "›";
      container.appendChild(sep);
    }
    const btn = document.createElement("button");
    btn.className = "breadcrumb-item";
    btn.type = "button";
    btn.textContent = part.replace(/\\/$/, "");
    btn.title = joinPathParts(parts, index);
    btn.addEventListener("click", () => navigateTo(joinPathParts(parts, index), { pushHistory: true }));
    container.appendChild(btn);
  });
}

function updateBrowseNav() {
  const data = state.browse.data;
  const hasParent = Boolean(data?.parent_path);
  $("#btn-up").disabled = !hasParent;
  $("#btn-back").disabled = state.browse.history.length === 0;
  if (data?.path) renderBreadcrumbs(data.path);
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
        <p>Nothing here</p>
      </li>`;
    return;
  }
  items.forEach((item, index) => container.appendChild(renderer(item, index)));
}

function createFileItem(entry, { mode = "browse" } = {}) {
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
    <div class="file-item-action">${entry.is_dir ? ICONS.chevron : ""}</div>
  `;

  li.addEventListener("click", () => selectItem(entry.path, entry.name));

  li.addEventListener("dblclick", () => {
    if (entry.is_dir) {
      navigateTo(entry.path, { pushHistory: true });
    } else {
      openItem(entry.path);
    }
  });

  return li;
}

function createPinItem(item) {
  const li = document.createElement("li");
  li.className = "file-item pin-item";
  li.dataset.path = item.path;

  const emoji = LOCATION_ICONS[item.icon] || LOCATION_ICONS.folder;
  const meta = `${item.file_count} files · ${item.folder_count} folders`;

  li.innerHTML = `
    <div class="file-item-icon location">${emoji}</div>
    <div class="file-item-info">
      <div class="file-item-name">${escapeHtml(item.name)}</div>
      <div class="file-item-meta">${escapeHtml(meta)}</div>
    </div>
    <button class="btn-icon btn-remove-pin" title="Remove pin" type="button">${ICONS.remove}</button>
  `;

  li.querySelector(".file-item-info").addEventListener("click", () => selectItem(item.path, item.name));
  li.addEventListener("dblclick", () => navigateTo(item.path, { pushHistory: false, switchTab: true }));

  li.querySelector(".btn-remove-pin").addEventListener("click", (e) => {
    e.stopPropagation();
    removePin(item.path);
  });

  return li;
}

async function selectItem(path, name) {
  state.selectedPath = path;
  state.selectedName = name;
  setSelectionInfo(name);
  $("#tab-preview").classList.add("has-selection");
  $$(".file-item.selected").forEach((el) => el.classList.remove("selected"));
  $$(`.file-item[data-path="${CSS.escape(path)}"]`).forEach((el) => el.classList.add("selected"));
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
  $("#preview-content").classList.remove("hidden");

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
  const sortedChildren = sortEntries(data.children || [], state.browse);

  if (data.is_dir) {
    bodyTitle.textContent = `Contents (${sortedChildren.length})`;
    textEl.classList.add("hidden");
    childrenEl.classList.remove("hidden");
    childrenEl.innerHTML = "";
    if (sortedChildren.length === 0) {
      childrenEl.innerHTML = `<li class="empty-state"><p>This folder is empty</p></li>`;
    } else {
      sortedChildren.forEach((entry) => {
        childrenEl.appendChild(createFileItem(entry));
      });
    }
  } else {
    bodyTitle.textContent = "Preview";
    childrenEl.classList.add("hidden");
    textEl.classList.remove("hidden");
    textEl.textContent = data.content;
  }
}

function renderBrowseList() {
  if (!state.browse.data) return;
  const sorted = sortEntries(state.browse.data.files, state.browse);
  renderList("#browse-list", sorted, (f) => createFileItem(f));
  const { file_count, folder_count, label, path } = state.browse.data;
  $("#browse-tab-label").textContent = `${label} · ${file_count}f ${folder_count}d`;
  setStatus(`${path} · ${file_count} files · ${folder_count} folders`);
  updateBrowseNav();
}

function renderRecentList() {
  const sorted = sortEntries(state.recent.files, state.recent);
  renderList("#recent-list", sorted, (f) => createFileItem(f, { mode: "recent" }));
}

async function navigateTo(path, { pushHistory = true, switchTab: goToBrowse = true } = {}) {
  if (pushHistory && state.browse.data?.path && state.browse.data.path !== path) {
    state.browse.history.push(state.browse.data.path);
  }
  try {
    const data = await invoke("browse_directory", { path });
    state.browse.data = data;
    renderBrowseList();
    if (goToBrowse) switchTab("browse");
  } catch (err) {
    setStatus(`Error: ${err}`);
  }
}

function navigateBack() {
  const prev = state.browse.history.pop();
  if (prev) navigateTo(prev, { pushHistory: false });
}

function navigateUp() {
  const parent = state.browse.data?.parent_path;
  if (parent) navigateTo(parent, { pushHistory: true });
}

async function loadQuickAccess() {
  try {
    const items = await invoke("get_quick_access");
    state.quickAccessPins = items;
    renderList("#quick-access-list", items, (item) => createPinItem(item));
  } catch (err) {
    setStatus(`Quick access error: ${err}`);
  }
}

async function loadRecent() {
  try {
    state.recent.files = await invoke("get_recent_files", { limit: 50 });
    renderRecentList();
  } catch (err) {
    setStatus(`Recent error: ${err}`);
  }
}

async function loadInitialBrowse() {
  try {
    const data = await invoke("get_desktop_contents");
    state.browse.data = data;
    state.browse.history = [];
    renderBrowseList();
  } catch (err) {
    setStatus(`Browse error: ${err}`);
  }
}

async function chooseFolder(title = "Choose a folder") {
  if (!pickFolder) {
    setStatus("Folder picker unavailable");
    return null;
  }
  const selected = await pickFolder({ directory: true, multiple: false, title });
  return selected || null;
}

function folderNameFromPath(path) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

async function addPinFromPath(path, name) {
  const pins = state.quickAccessPins.map((p) => ({
    name: p.name,
    path: p.path,
    icon: p.icon || "folder",
  }));

  if (pins.some((p) => p.path.toLowerCase() === path.toLowerCase())) {
    setStatus("Folder is already pinned");
    return;
  }

  pins.push({ name: name || folderNameFromPath(path), path, icon: "folder" });
  try {
    const items = await invoke("save_quick_access", { pins });
    state.quickAccessPins = items;
    renderList("#quick-access-list", items, (item) => createPinItem(item));
    setStatus(`Pinned ${name || folderNameFromPath(path)}`);
  } catch (err) {
    setStatus(`Could not save pin: ${err}`);
  }
}

async function addPinDialog() {
  const path = await chooseFolder("Pin a folder to Quick Access");
  if (path) await addPinFromPath(path);
}

async function pinCurrentFolder() {
  const path = state.browse.data?.path;
  if (!path) return;
  await addPinFromPath(path, state.browse.data.label);
}

async function removePin(path) {
  const pins = state.quickAccessPins
    .filter((p) => p.path !== path)
    .map((p) => ({ name: p.name, path: p.path, icon: p.icon || "folder" }));
  try {
    const items = await invoke("save_quick_access", { pins });
    state.quickAccessPins = items;
    renderList("#quick-access-list", items, (item) => createPinItem(item));
    setStatus("Pin removed");
  } catch (err) {
    setStatus(`Could not remove pin: ${err}`);
  }
}

async function resetPins() {
  try {
    const items = await invoke("reset_quick_access");
    state.quickAccessPins = items;
    renderList("#quick-access-list", items, (item) => createPinItem(item));
    setStatus("Quick access reset to defaults");
  } catch (err) {
    setStatus(`Reset error: ${err}`);
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
    setStatus(`Could not reveal: ${err}`);
  }
}

async function refreshAll() {
  const btn = $("#btn-refresh");
  btn.classList.add("spinning");
  await Promise.all([loadQuickAccess(), loadRecent(), loadInitialBrowse()]);
  if (state.activeTab === "browse") renderBrowseList();
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

function initSortControls() {
  $("#browse-sort-by").addEventListener("change", (e) => {
    state.browse.sortBy = e.target.value;
    savePrefs();
    renderBrowseList();
  });
  $("#browse-sort-order").addEventListener("change", (e) => {
    state.browse.sortOrder = e.target.value;
    savePrefs();
    renderBrowseList();
  });
  $("#browse-folders-first").addEventListener("change", (e) => {
    state.browse.foldersFirst = e.target.checked;
    savePrefs();
    renderBrowseList();
  });
  $("#recent-sort-by").addEventListener("change", (e) => {
    state.recent.sortBy = e.target.value;
    savePrefs();
    renderRecentList();
  });
  $("#recent-sort-order").addEventListener("change", (e) => {
    state.recent.sortOrder = e.target.value;
    savePrefs();
    renderRecentList();
  });
}

function initActions() {
  $("#btn-refresh").addEventListener("click", refreshAll);
  $("#btn-back").addEventListener("click", navigateBack);
  $("#btn-up").addEventListener("click", navigateUp);
  $("#btn-add-pin").addEventListener("click", addPinDialog);
  $("#btn-reset-pins").addEventListener("click", resetPins);
  $("#btn-pin-current").addEventListener("click", pinCurrentFolder);
  $("#btn-open-browse").addEventListener("click", () => {
    if (state.browse.data?.path) openPath(state.browse.data.path);
  });
  $("#btn-open-item").addEventListener("click", () => {
    if (state.previewData) openItem(state.previewData.path);
  });
  $("#btn-open-location").addEventListener("click", () => {
    if (!state.previewData) return;
    if (state.previewData.is_dir) {
      openItem(state.previewData.path);
    } else {
      showInFolder(state.previewData.path);
    }
  });
  $("#btn-browse-item").addEventListener("click", () => {
    if (!state.previewData) return;
    const target = state.previewData.is_dir
      ? state.previewData.path
      : state.previewData.path.replace(/[\\/][^\\/]+$/, "");
    if (target) navigateTo(target, { pushHistory: true });
  });
}

async function init() {
  loadPrefs();
  applyPrefsToUI();
  initTabs();
  initSortControls();
  initActions();
  setStatus("Loading…");
  await refreshAll();
}

document.addEventListener("DOMContentLoaded", init);
