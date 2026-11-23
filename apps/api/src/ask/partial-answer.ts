/**
 * Reads the model's answer while it is still being generated.
 *
 * The model answers as JSON `{"answerable": …, "answer": "…", "citations": […]}` (structured output,
 * ANSWER_SCHEMA), so the streamed text is an unfinished JSON document until the very end. Instead of
 * switching the prompt to free text with markers (and losing the constrained decoding that the eval
 * results were measured with), the stream keeps the same JSON and this reads the two fields a reader
 * needs early: `answerable` (comes first in the schema) and the decoded prefix of `answer`.
 */
export interface PartialAnswer {
  /** `undefined` until the model has written it. */
  answerable?: boolean;
  /** The decoded part of the `answer` string written so far (complete characters only). */
  answer: string;
}

const ANSWERABLE = /"answerable"\s*:\s*(true|false)/;
// `"answerable"` does not match: the key must close right after `answer`.
const ANSWER_START = /"answer"\s*:\s*"/;

export function readPartialAnswer(json: string): PartialAnswer {
  const flag = ANSWERABLE.exec(json);
  const answerable = flag ? flag[1] === 'true' : undefined;

  const start = ANSWER_START.exec(json);
  if (!start) return { answerable, answer: '' };

  const from = start.index + start[0].length;
  let end = from; // exclusive end of the complete characters
  for (let i = from; i < json.length;) {
    const c = json[i];
    if (c === '"') break; // closing quote: the string is complete
    if (c !== '\\') {
      end = i = i + 1;
      continue;
    }
    // An escape is complete only when all its characters have arrived: \n is 2, é is 6.
    const size = json[i + 1] === 'u' ? 6 : 2;
    if (i + size > json.length) break;
    end = i = i + size;
  }
  return { answerable, answer: JSON.parse(`"${json.slice(from, end)}"`) as string };
}

/**
 * Turns the growing JSON into text deltas of `answer`. Nothing is emitted while `answerable` is
 * unknown or false: a refusal should not flash a half-written answer.
 */
export class AnswerDeltas {
  private json = '';
  private emitted = 0;

  push(chunk: string): string {
    this.json += chunk;
    const { answerable, answer } = readPartialAnswer(this.json);
    if (answerable !== true || answer.length <= this.emitted) return '';
    const delta = answer.slice(this.emitted);
    this.emitted = answer.length;
    return delta;
  }
}
