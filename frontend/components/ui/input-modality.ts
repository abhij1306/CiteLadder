/**
 * How the reader last used the page: a key or a pointer. Browsers decide
 * `:focus-visible` by heuristic, and when a window or tab regains focus they
 * fire `focus` again on the element that had it, so a button that was only
 * clicked repaints its ring and a tooltip that opens on focus opens by itself
 * (leftover paint on returning to the tab). Tracking the reader's real input
 * fixes both once, for every surface:
 *
 *  - `<html data-input-modality="pointer">` after a press; the focus-ring
 *    rules in globals.css draw no ring under it, and the next key brings the
 *    ring back.
 *  - `focusFromKeyboard()` is true only when the last input was a key and the
 *    window has not lost focus since, so a Tooltip opens on focus for a
 *    keyboard reader's Tab and never for a restored focus.
 *
 * A shortcut (Ctrl, Alt or Meta held, as when switching tabs) is not keyboard
 * navigation and changes nothing.
 */
type InputModality = 'keyboard' | 'pointer';

let modality: InputModality | null = null;
/** True from the window losing focus until the reader's next key or press. */
let away = false;
let installed = false;

function set(next: InputModality) {
  modality = next;
  away = false;
  document.documentElement.dataset.inputModality = next;
}

function onKeyDown(event: KeyboardEvent) {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  set('keyboard');
}

function onPointerDown() {
  set('pointer');
}

// An element's blur does not bubble, so a listener on the window (not in the
// capture phase) hears only the window itself losing focus.
function onWindowBlur() {
  away = true;
}

/** Starts tracking once, when this module first loads. */
function trackInputModality() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // Capture, so a handler that stops propagation cannot hide an input.
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('blur', onWindowBlur);
}

/** Whether a focus arriving now came from the keyboard, not a press or a restored window. */
export function focusFromKeyboard(): boolean {
  return modality === 'keyboard' && !away;
}

trackInputModality();
