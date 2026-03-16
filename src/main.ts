import Database from "@tauri-apps/plugin-sql";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { save, open, message } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { relativeTime, escapeHtml } from "./shared/time";

interface Folder {
  id: number;
  name: string;
  color: string;
  created_at: string;
  idea_count: number;
}

interface Idea {
  id: number;
  text: string;
  folder_id: number;
  folder_color?: string;
  folder_name?: string;
  created_at: string;
}

const INBOX_ID = 1;
const FOLDER_COLORS = [
  "#6b7280", "#ef4444", "#f59e0b", "#22c55e", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1",
];

const db = await Database.load("sqlite:quicknote.db");
const searchInput = document.getElementById("search") as HTMLInputElement;
const ideasList = document.getElementById("ideas-list")!;
const emptyState = document.getElementById("empty-state")!;
const emptyMessage = document.getElementById("empty-message")!;
const folderListEl = document.getElementById("folder-list")!;
const newFolderBtn = document.getElementById("new-folder-btn")!;
const newFolderForm = document.getElementById("new-folder-form")!;
const folderNameInput = document.getElementById("folder-name-input") as HTMLInputElement;
const colorPaletteEl = document.getElementById("color-palette")!;
const folderSaveBtn = document.getElementById("folder-save-btn")!;
const folderCancelBtn = document.getElementById("folder-cancel-btn")!;
const contextMenu = document.getElementById("context-menu")!;
const contextMenuFolders = document.getElementById("context-menu-folders")!;
const contextMenuDelete = document.getElementById("context-menu-delete")!;
const deleteFolderDialog = document.getElementById("delete-folder-dialog")!;
const deleteFolderName = document.getElementById("delete-folder-name")!;
const deleteFolderConfirm = document.getElementById("delete-folder-confirm")!;
const deleteFolderCancel = document.getElementById("delete-folder-cancel")!;
const allCount = document.getElementById("all-count")!;
const inboxCount = document.getElementById("inbox-count")!;

let activeFolderId: number | "all" = "all";
let folders: Folder[] = [];
let selectedColor = FOLDER_COLORS[0];
let contextMenuIdeaId: number | null = null;
let deletingFolderId: number | null = null;

// --- Folder CRUD ---

async function loadFolders() {
  folders = await db.select<Folder[]>(
    `SELECT f.id, f.name, f.color, f.created_at,
            COUNT(i.id) as idea_count
     FROM folders f
     LEFT JOIN ideas i ON i.folder_id = f.id
     GROUP BY f.id
     ORDER BY CASE WHEN f.id = 1 THEN 0 ELSE 1 END,
              COALESCE(MAX(i.created_at), f.created_at) DESC`,
  );

  const totalCount: { cnt: number }[] = await db.select("SELECT COUNT(*) as cnt FROM ideas");
  allCount.textContent = String(totalCount[0].cnt || "");

  const inbox = folders.find((f) => f.id === INBOX_ID);
  inboxCount.textContent = String(inbox?.idea_count || "");

  // Update inbox dot color
  const inboxItem = document.querySelector('.sidebar-item[data-folder="1"]');
  if (inboxItem) {
    const dot = inboxItem.querySelector(".folder-dot") as HTMLElement;
    if (dot && inbox) dot.style.background = inbox.color;
  }

  renderSidebar();
}

function renderSidebar() {
  const userFolders = folders.filter((f) => f.id !== INBOX_ID);
  folderListEl.innerHTML = userFolders
    .map(
      (f) => `
    <div class="sidebar-item${activeFolderId === f.id ? " active" : ""}" data-folder="${f.id}">
      <span class="folder-dot" style="background:${escapeHtml(f.color)}"></span>
      <span>${escapeHtml(f.name)}</span>
      <span class="folder-count">${f.idea_count || ""}</span>
      <button class="delete-folder-btn" data-folder-id="${f.id}" title="Delete folder">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`,
    )
    .join("");

  // Update active state on static items
  document.querySelectorAll(".sidebar-item[data-folder]").forEach((el) => {
    const folderId = el.getAttribute("data-folder");
    el.classList.toggle("active", folderId === String(activeFolderId));
  });

  // Attach click handlers on all sidebar items
  document.querySelectorAll(".sidebar-item[data-folder]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".delete-folder-btn")) return;
      const val = el.getAttribute("data-folder")!;
      activeFolderId = val === "all" ? "all" : Number(val);
      loadFolders();
      loadIdeas(searchInput.value.trim() || undefined);
    });

    // Drop target for drag-and-drop
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      const folderId = el.getAttribute("data-folder");
      if (folderId && folderId !== "all") {
        el.classList.add("drag-over");
      }
    });
    el.addEventListener("dragleave", () => {
      el.classList.remove("drag-over");
    });
    el.addEventListener("drop", async (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      const folderId = el.getAttribute("data-folder");
      if (!folderId || folderId === "all") return;
      const ideaId = Number((e as DragEvent).dataTransfer?.getData("text/plain"));
      if (ideaId) await moveIdeaToFolder(ideaId, Number(folderId));
    });
  });

  // Delete folder buttons
  folderListEl.querySelectorAll(".delete-folder-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const folderId = Number((btn as HTMLElement).dataset.folderId);
      const folder = folders.find((f) => f.id === folderId);
      if (folder) showDeleteFolderDialog(folderId, folder.name);
    });
  });
}

async function createFolder(name: string, color: string) {
  await db.execute("INSERT INTO folders (name, color) VALUES ($1, $2)", [name, color]);
  await loadFolders();
}

async function deleteFolder(id: number, moveToInbox: boolean) {
  if (moveToInbox) {
    await db.execute("UPDATE ideas SET folder_id = $1 WHERE folder_id = $2", [INBOX_ID, id]);
  } else {
    await db.execute("DELETE FROM ideas WHERE folder_id = $1", [id]);
  }
  await db.execute("DELETE FROM folders WHERE id = $1", [id]);
  if (activeFolderId === id) activeFolderId = "all";
  await loadFolders();
  await loadIdeas(searchInput.value.trim() || undefined);
}

async function moveIdeaToFolder(ideaId: number, folderId: number) {
  await db.execute("UPDATE ideas SET folder_id = $1 WHERE id = $2", [folderId, ideaId]);
  await loadFolders();
  await loadIdeas(searchInput.value.trim() || undefined);
}

// --- Ideas ---

async function loadIdeas(query?: string) {
  let ideas: Idea[];
  const params: (string | number)[] = [];
  let sql =
    "SELECT i.*, f.color as folder_color, f.name as folder_name FROM ideas i LEFT JOIN folders f ON i.folder_id = f.id";
  const conditions: string[] = [];

  if (activeFolderId !== "all") {
    params.push(activeFolderId);
    conditions.push(`i.folder_id = $${params.length}`);
  }
  if (query) {
    params.push(`%${query}%`);
    conditions.push(`i.text LIKE $${params.length}`);
  }
  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY i.created_at DESC";

  ideas = await db.select<Idea[]>(sql, params);
  renderIdeas(ideas, !!query);
}

function renderIdeas(ideas: Idea[], isSearch: boolean) {
  if (ideas.length === 0) {
    ideasList.innerHTML = "";
    emptyState.hidden = false;
    emptyMessage.textContent = isSearch
      ? "No ideas match your search."
      : activeFolderId === "all"
        ? "No ideas yet. Press Ctrl+Alt+N to capture one."
        : "No ideas in this folder.";
    return;
  }
  emptyState.hidden = true;
  const showFolderDot = activeFolderId === "all";
  ideasList.innerHTML = ideas
    .map(
      (idea) => `
    <div class="idea-row" data-id="${idea.id}" data-folder-id="${idea.folder_id}" draggable="true">
      ${showFolderDot ? `<span class="idea-folder-dot" style="background:${escapeHtml(idea.folder_color || "#6b7280")}" title="${escapeHtml(idea.folder_name || "Inbox")}"></span>` : ""}
      <span class="idea-text">${escapeHtml(idea.text)}</span>
      <span class="idea-time">${relativeTime(idea.created_at)}</span>
      <button class="delete-btn" title="Delete idea">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    </div>`,
    )
    .join("");
}

// --- New Idea FAB + Modal ---

const fabAdd = document.getElementById("fab-add")!;
const newIdeaDialog = document.getElementById("new-idea-dialog")!;
const newIdeaText = document.getElementById("new-idea-text") as HTMLTextAreaElement;
const newIdeaSave = document.getElementById("new-idea-save")!;
const newIdeaCancel = document.getElementById("new-idea-cancel")!;

function openNewIdeaModal() {
  newIdeaText.value = "";
  newIdeaDialog.hidden = false;
  newIdeaText.focus();
}

function closeNewIdeaModal() {
  newIdeaDialog.hidden = true;
  newIdeaText.value = "";
}

async function saveNewIdea() {
  const text = newIdeaText.value.trim();
  if (!text) return;
  const folderId = activeFolderId === "all" ? INBOX_ID : activeFolderId;
  await db.execute("INSERT INTO ideas (text, folder_id) VALUES ($1, $2)", [text, folderId]);
  closeNewIdeaModal();
  await loadFolders();
  await loadIdeas(searchInput.value.trim() || undefined);
}

fabAdd.addEventListener("click", openNewIdeaModal);
newIdeaSave.addEventListener("click", saveNewIdea);
newIdeaCancel.addEventListener("click", closeNewIdeaModal);

newIdeaText.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.ctrlKey) {
    e.preventDefault();
    saveNewIdea();
  }
  if (e.key === "Escape") closeNewIdeaModal();
});

newIdeaDialog.addEventListener("click", (e) => {
  if (e.target === newIdeaDialog) closeNewIdeaModal();
});

// Delete via event delegation
ideasList.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest(".delete-btn");
  if (btn) {
    const row = btn.closest(".idea-row") as HTMLElement;
    const id = Number(row.dataset.id);
    await db.execute("DELETE FROM ideas WHERE id = $1", [id]);
    await loadFolders();
    await loadIdeas(searchInput.value.trim() || undefined);
  }
});

// --- Drag and drop ---

ideasList.addEventListener("dragstart", (e) => {
  const row = (e.target as HTMLElement).closest(".idea-row") as HTMLElement;
  if (!row) return;
  e.dataTransfer!.setData("text/plain", row.dataset.id!);
  e.dataTransfer!.effectAllowed = "move";
  requestAnimationFrame(() => row.classList.add("dragging"));
});

ideasList.addEventListener("dragend", (e) => {
  const row = (e.target as HTMLElement).closest(".idea-row") as HTMLElement;
  if (row) row.classList.remove("dragging");
  document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
});

// --- Context menu ---

ideasList.addEventListener("contextmenu", (e) => {
  const row = (e.target as HTMLElement).closest(".idea-row") as HTMLElement;
  if (!row) return;
  e.preventDefault();
  contextMenuIdeaId = Number(row.dataset.id);
  const currentFolderId = Number(row.dataset.folderId);

  // Populate folder options
  contextMenuFolders.innerHTML = folders
    .filter((f) => f.id !== currentFolderId)
    .map(
      (f) =>
        `<button class="context-menu-option" data-move-to="${f.id}">
          <span class="folder-dot" style="background:${escapeHtml(f.color)}"></span>
          ${escapeHtml(f.name)}
        </button>`,
    )
    .join("");

  // Position with boundary clamping
  const menuWidth = 180;
  const menuHeight = 200;
  const x = Math.min((e as MouseEvent).clientX, window.innerWidth - menuWidth);
  const y = Math.min((e as MouseEvent).clientY, window.innerHeight - menuHeight);
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.hidden = false;

  // Attach move handlers
  contextMenuFolders.querySelectorAll("[data-move-to]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetId = Number((btn as HTMLElement).dataset.moveTo);
      if (contextMenuIdeaId) await moveIdeaToFolder(contextMenuIdeaId, targetId);
      contextMenu.hidden = true;
    });
  });
});

contextMenuDelete.addEventListener("click", async () => {
  if (contextMenuIdeaId) {
    await db.execute("DELETE FROM ideas WHERE id = $1", [contextMenuIdeaId]);
    contextMenu.hidden = true;
    await loadFolders();
    await loadIdeas(searchInput.value.trim() || undefined);
  }
});

document.addEventListener("click", () => {
  contextMenu.hidden = true;
});
contextMenu.addEventListener("click", (e) => e.stopPropagation());

// --- New folder form ---

newFolderBtn.addEventListener("click", () => {
  newFolderForm.hidden = false;
  newFolderBtn.hidden = true;
  folderNameInput.value = "";
  selectedColor = FOLDER_COLORS[0];
  renderColorPalette();
  folderNameInput.focus();
});

function renderColorPalette() {
  colorPaletteEl.innerHTML = FOLDER_COLORS.map(
    (c) =>
      `<div class="color-swatch${c === selectedColor ? " selected" : ""}" data-color="${c}" style="background:${c}"></div>`,
  ).join("");

  colorPaletteEl.querySelectorAll(".color-swatch").forEach((el) => {
    el.addEventListener("click", () => {
      selectedColor = (el as HTMLElement).dataset.color!;
      renderColorPalette();
    });
  });
}

function hideNewFolderForm() {
  newFolderForm.hidden = true;
  newFolderBtn.hidden = false;
}

folderSaveBtn.addEventListener("click", async () => {
  const name = folderNameInput.value.trim();
  if (!name) return;
  await createFolder(name, selectedColor);
  hideNewFolderForm();
});

folderCancelBtn.addEventListener("click", hideNewFolderForm);

folderNameInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    const name = folderNameInput.value.trim();
    if (!name) return;
    await createFolder(name, selectedColor);
    hideNewFolderForm();
  }
  if (e.key === "Escape") hideNewFolderForm();
});

// --- Delete folder dialog ---

function showDeleteFolderDialog(folderId: number, folderName: string) {
  deletingFolderId = folderId;
  deleteFolderName.textContent = folderName;
  (document.querySelector('input[name="delete-action"][value="move"]') as HTMLInputElement).checked = true;
  deleteFolderDialog.hidden = false;
}

deleteFolderConfirm.addEventListener("click", async () => {
  if (deletingFolderId === null) return;
  const action = (document.querySelector('input[name="delete-action"]:checked') as HTMLInputElement).value;
  await deleteFolder(deletingFolderId, action === "move");
  deleteFolderDialog.hidden = true;
  deletingFolderId = null;
});

deleteFolderCancel.addEventListener("click", () => {
  deleteFolderDialog.hidden = true;
  deletingFolderId = null;
});

deleteFolderDialog.addEventListener("click", (e) => {
  if (e.target === deleteFolderDialog) {
    deleteFolderDialog.hidden = true;
    deletingFolderId = null;
  }
});

// --- Search ---

let searchTimeout: number;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = window.setTimeout(() => {
    loadIdeas(searchInput.value.trim() || undefined);
  }, 200);
});

// Refresh when window gains focus
getCurrentWindow().listen("tauri://focus", () => {
  loadFolders();
  loadIdeas(searchInput.value.trim() || undefined);
});

// Enable autostart on first run
if (!(await isEnabled())) {
  await enable();
}

// --- File menu dropdown ---
const menuTrigger = document.querySelector(".menu-trigger")!;
const menuDropdown = document.querySelector(".menu-dropdown") as HTMLElement;
const exportBtn = document.getElementById("export-json-btn")!;
const importBtn = document.getElementById("import-json-btn")!;
const aboutBtn = document.getElementById("about-btn")!;

function closeMenu() {
  menuDropdown.hidden = true;
  menuTrigger.classList.remove("active");
}

menuTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  const isOpen = !menuDropdown.hidden;
  menuDropdown.hidden = isOpen;
  menuTrigger.classList.toggle("active", !isOpen);
});

document.addEventListener("click", () => closeMenu());
menuDropdown.addEventListener("click", (e) => e.stopPropagation());

// Export as JSON
exportBtn.addEventListener("click", async () => {
  closeMenu();

  const ideas: Idea[] = await db.select(
    `SELECT i.*, f.name as folder_name, f.color as folder_color
     FROM ideas i LEFT JOIN folders f ON i.folder_id = f.id
     ORDER BY i.created_at DESC`,
  );

  const filePath = await save({
    defaultPath: "quicknote-export.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (!filePath) return;

  await writeTextFile(filePath, JSON.stringify(ideas, null, 2));
  await message(`Exported ${ideas.length} idea${ideas.length === 1 ? "" : "s"} successfully.`, {
    title: "Export Complete",
    kind: "info",
  });
});

// Import from JSON
importBtn.addEventListener("click", async () => {
  closeMenu();

  const filePath = await open({
    filters: [{ name: "JSON", extensions: ["json"] }],
    multiple: false,
  });

  if (!filePath) return;

  const content = await readTextFile(filePath);
  let ideas: unknown[];
  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    ideas = parsed;
  } catch {
    await message("The selected file is not a valid Quicknote JSON export.", {
      title: "Import Failed",
      kind: "error",
    });
    return;
  }

  let imported = 0;
  for (const item of ideas) {
    const idea = item as Record<string, unknown>;
    if (typeof idea.text !== "string" || !idea.text.trim()) continue;
    const createdAt = typeof idea.created_at === "string" ? idea.created_at : new Date().toISOString();

    // Resolve folder
    let folderId = INBOX_ID;
    if (typeof idea.folder_name === "string" && idea.folder_name !== "Inbox") {
      const existing: { id: number }[] = await db.select(
        "SELECT id FROM folders WHERE name = $1",
        [idea.folder_name],
      );
      if (existing.length) {
        folderId = existing[0].id;
      } else {
        const color = typeof idea.folder_color === "string" ? idea.folder_color : FOLDER_COLORS[0];
        const result = await db.execute(
          "INSERT INTO folders (name, color) VALUES ($1, $2)",
          [idea.folder_name, color],
        );
        folderId = result.lastInsertId ?? INBOX_ID;
      }
    }

    // Skip duplicates by matching text + created_at
    const existing: Idea[] = await db.select(
      "SELECT id FROM ideas WHERE text = $1 AND created_at = $2",
      [idea.text, createdAt],
    );
    if (existing.length === 0) {
      await db.execute("INSERT INTO ideas (text, folder_id, created_at) VALUES ($1, $2, $3)", [
        idea.text,
        folderId,
        createdAt,
      ]);
      imported++;
    }
  }

  await loadFolders();
  await loadIdeas(searchInput.value.trim() || undefined);
  await message(`Imported ${imported} idea${imported === 1 ? "" : "s"}.`, {
    title: "Import Complete",
    kind: "info",
  });
});

// About Quicknote
aboutBtn.addEventListener("click", async () => {
  closeMenu();
  await message("Quicknote v0.1.0\nA minimal idea capture tool.", {
    title: "About Quicknote",
    kind: "info",
  });
});

// --- Initial load ---
await loadFolders();
await loadIdeas();
