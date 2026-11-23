type InputModality = 'keyboard' | 'pointer';

let modality: InputModality | null = null;
let keyDown = false;
let tabDown = false;
let pressed = false;
let away = false;
let installed = false;

function set(next: InputModality) {
  modality = next;
  away = false;
  document.documentElement.dataset.inputModality = next;
}

const TEXT_FIELD =
  'input:not([type=button], [type=checkbox], [type=radio], [type=range], [type=reset], [type=submit]), textarea, select, [contenteditable]:not([contenteditable=false])';
const OVERLAY = 'dialog, [role=dialog], [role=alertdialog], [role=menu]';

function textField(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement && target.matches(TEXT_FIELD) ? target : null;
}

function onKeyDown(event: KeyboardEvent) {
  keyDown = !(event.ctrlKey || event.altKey || event.metaKey || event.key === 'Escape');
  tabDown = keyDown && event.key === 'Tab';
  if (tabDown) delete textField(document.activeElement)?.dataset.quietFocus;
}

function onKeyUp() {
  keyDown = false;
  tabDown = false;
}

function onFocusIn(event: FocusEvent) {
  if (keyDown) set('keyboard');
  const field = textField(event.target);
  if (!field) return;
  if (!tabDown && (!pressed || field.closest(OVERLAY))) field.dataset.quietFocus = '';
  else delete field.dataset.quietFocus;
}

function onFocusOut(event: FocusEvent) {
  const field = textField(event.target);
  if (field) delete field.dataset.quietFocus;
}

function onPointerDown(event: PointerEvent) {
  keyDown = false;
  tabDown = false;
  pressed = true;
  set('pointer');
  const field = textField(event.target);
  if (field && field === document.activeElement && field.closest(OVERLAY)) {
    field.dataset.quietFocus = '';
  }
}

function onPointerUp() {
  pressed = false;
}

function onWindowBlur() {
  away = true;
  keyDown = false;
  tabDown = false;
  pressed = false;
}

function trackInputModality() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', onPointerUp, true);
  window.addEventListener('blur', onWindowBlur);
}

export function focusFromKeyboard(): boolean {
  return modality === 'keyboard' && !away;
}

trackInputModality();
