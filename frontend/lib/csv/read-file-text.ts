const NOT_UTF8_MESSAGE = 'This file is not UTF-8 text. Save as CSV UTF-8 and upload again.';
export const READ_FAILED_MESSAGE = 'The file could not be read. Choose it again.';

/** The file's bytes, including jsdom's FileReader fallback for a File without arrayBuffer(). */
function readBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    const failed = () => reject(new Error(READ_FAILED_MESSAGE));
    reader.onload = () =>
      reader.result instanceof ArrayBuffer ? resolve(reader.result) : failed();
    reader.onerror = failed;
    reader.readAsArrayBuffer(file); // NOSONAR -- the fallback for jsdom, whose File has no arrayBuffer(); browsers take the branch above
  });
}

/**
 * Read an uploaded import file (a CSV or a product feed) as UTF-8 text.
 *
 * Decoding is strict: a byte sequence that is not UTF-8 refuses the whole file
 * instead of becoming U+FFFD, so `Café` saved as Windows-1252 is never
 * imported as `Caf�`. A UTF-8 byte-order mark is dropped. Both refusals carry
 * the sentence the import shows.
 */
export async function readCsvFileText(file: File): Promise<string> {
  let bytes: ArrayBuffer;
  try {
    bytes = await readBytes(file);
  } catch {
    throw new Error(READ_FAILED_MESSAGE);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(NOT_UTF8_MESSAGE);
  }
}
