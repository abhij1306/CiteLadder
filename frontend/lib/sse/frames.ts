/** One raw `field: value` Server-Sent Event frame. */
export type RawSseFrame = {
  id: string | null;
  event: string | null;
  data: string;
};

/** Split chunked SSE text into complete frames and an unfinished remainder. */
export function splitSseFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buffer;
  let separator = rest.indexOf('\n\n');
  while (separator !== -1) {
    frames.push(rest.slice(0, separator));
    rest = rest.slice(separator + 2);
    separator = rest.indexOf('\n\n');
  }
  return { frames, rest };
}

/** Parse standard SSE fields, ignoring comments and unknown extension fields. */
export function parseSseFrame(frame: string): RawSseFrame {
  let id: string | null = null;
  let event: string | null = null;
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  return { id, event, data: data.join('\n') };
}
