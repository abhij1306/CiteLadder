/**
 * True while an input method (Japanese, Chinese, Korean) is composing, so its
 * Enter confirms the candidate instead of sending. Safari reports
 * `isComposing` false on the confirming keydown and only sets `keyCode` 229.
 */
export function isImeComposing(event: Readonly<{ nativeEvent: KeyboardEvent }>): boolean {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229; // NOSONAR -- deprecated keyCode is Safari's only composition signal
}
