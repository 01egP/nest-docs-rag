/** One server-sent event: the `event:` name (default "message") and its `data:` lines joined by \n. */
export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Reads a `text/event-stream` body into events. The network may cut anywhere — between events, inside
 * a line, inside a multi-byte character — so bytes are decoded with `stream: true` and only complete
 * lines are parsed. Comments (`: searching`) and `id:` / `retry:` fields are skipped; an event is
 * dispatched on a blank line, and one left unterminated when the stream ends is dropped, as the spec
 * says. https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];

  function* line(text: string): Generator<SseMessage> {
    if (text === '') {
      if (data.length) yield { event: event || 'message', data: data.join('\n') };
      event = '';
      data = [];
      return;
    }
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }

  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // A line ends with \n, \r\n or \r; mid-stream a trailing \r may still be the first half of \r\n.
      const eol = done ? /\r\n|\n|\r/ : /\r\n|\n|\r(?!$)/;
      let end: number;
      while ((end = buffer.search(eol)) !== -1) {
        const sep = buffer.startsWith('\r\n', end) ? 2 : 1;
        yield* line(buffer.slice(0, end));
        buffer = buffer.slice(end + sep);
      }
      if (done) {
        finished = true;
        return;
      }
    }
  } finally {
    // The caller stopped early (break / return): tell the server we are not reading any more.
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
