export function isImeComposing(event: Readonly<{ nativeEvent: KeyboardEvent }>): boolean {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229; // NOSONAR
}
