import { AGENT_ATTACHMENT_NAME_MAX_CHARS, type AgentAttachment } from '@citeladder/contracts/agent';

import { READ_FAILED_MESSAGE, readCsvFileText } from '@/lib/csv/read-file-text';

const TEXT_EXTENSIONS = ['csv', 'tsv', 'json', 'ndjson', 'jsonl', 'md', 'markdown', 'txt'];
const SAVE_AS_TEXT = ['xlsx', 'xls', 'ods', 'numbers', 'pdf', 'docx', 'doc', 'odt', 'pages', 'rtf'];
const MAX_BYTES_PER_CHAR = 4;

export const AGENT_ATTACHMENT_ACCEPT = TEXT_EXTENSIONS.map((extension) => `.${extension}`).join(
  ',',
);

type FileAttachment = Extract<AgentAttachment, { kind: 'file' }>;
export type AttachmentRead =
  | { kind: 'attached'; attachment: FileAttachment }
  | { kind: 'refused'; message: string };

const refused = (message: string): AttachmentRead => ({ kind: 'refused', message });

function extensionOf(name: string) {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export async function readAttachmentFile(file: File, maxChars: number): Promise<AttachmentRead> {
  const extension = extensionOf(file.name);
  if (SAVE_AS_TEXT.includes(extension))
    return refused(`${file.name} can't be read here. Save it as CSV, or paste the text.`);
  if (!TEXT_EXTENSIONS.includes(extension))
    return refused('Attach a CSV, TSV, JSON, NDJSON, Markdown or plain text file.');
  const tooLong = `${file.name} is longer than ${maxChars.toLocaleString('en-US')} characters. Attach part of it.`;
  if (file.size > maxChars * MAX_BYTES_PER_CHAR) return refused(tooLong);
  let text: string;
  try {
    text = await readCsvFileText(file);
  } catch (cause) {
    return refused(cause instanceof Error ? cause.message : READ_FAILED_MESSAGE);
  }
  if (!text.trim()) return refused(`${file.name} is empty.`);
  if (text.length > maxChars) return refused(tooLong);
  return {
    kind: 'attached',
    attachment: { kind: 'file', name: file.name.slice(0, AGENT_ATTACHMENT_NAME_MAX_CHARS), text },
  };
}
