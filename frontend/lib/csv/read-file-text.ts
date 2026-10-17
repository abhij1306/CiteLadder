/** Read an uploaded CSV as text, including jsdom's FileReader fallback. */
export function readCsvFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsText(file); // NOSONAR -- the fallback for jsdom, whose File has no text(); browsers take the branch above
  });
}
