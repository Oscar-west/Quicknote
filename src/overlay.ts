import Database from "@tauri-apps/plugin-sql";
import { getCurrentWindow } from "@tauri-apps/api/window";

const input = document.getElementById("idea-input") as HTMLTextAreaElement;
const savedText = document.getElementById("saved-text")!;
const hint = document.querySelector(".hint")!;
const currentWindow = getCurrentWindow();

const db = await Database.load("sqlite:quicknote.db");

const PASTEL_COLORS = [
  "rgba(200, 191, 231, 0.85)", // lavender
  "rgba(189, 236, 210, 0.85)", // mint
  "rgba(255, 218, 185, 0.85)", // peach
  "rgba(255, 255, 186, 0.85)", // soft yellow
  "rgba(186, 225, 255, 0.85)", // baby blue
];

function applyRandomColor() {
  const color = PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)];
  document.body.style.setProperty("--note-bg", color);
}

let dismissing = false;

function resetState() {
  dismissing = false;
  input.value = "";
  input.classList.remove("hidden");
  hint.classList.remove("hidden");
  savedText.classList.remove("visible");
  document.body.classList.remove("saved", "fade-out");
}

async function dismissWithFade() {
  if (dismissing) return;
  dismissing = true;
  document.body.classList.add("fade-out");
  await new Promise((r) => setTimeout(r, 200));
  await currentWindow.hide();
  resetState();
}

input.addEventListener("keydown", async (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    await db.execute("INSERT INTO ideas (text, folder_id) VALUES ($1, 1)", [text]);

    // Show "Saved" confirmation with flash
    input.classList.add("hidden");
    hint.classList.add("hidden");
    savedText.classList.add("visible");
    document.body.classList.add("saved");

    // Wait 0.5s then fade out
    await new Promise((r) => setTimeout(r, 500));
    await dismissWithFade();
  }
  if (e.key === "Escape") {
    await dismissWithFade();
  }
});

// Dismiss on focus loss (click outside)
currentWindow.onFocusChanged(({ payload: focused }) => {
  if (!focused) {
    dismissWithFade();
  }
});

// Re-focus input when window becomes visible
currentWindow.listen("tauri://focus", () => {
  resetState();
  applyRandomColor();
  input.focus();
});

// Apply random color on initial load
applyRandomColor();
