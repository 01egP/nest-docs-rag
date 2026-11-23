import type { AskResult, AskStreamEvent, Retrieval } from '../api/types';

/**
 * One question's lifecycle on the page:
 * idle → searching → answering (sources known, text growing) → done (answer or refusal),
 * or → error / cancelled from any step in between. A refusal is `done` with `result.answered: false`.
 */
export type AskState =
  | { phase: 'idle' }
  | { phase: 'searching'; question: string; startedAt: number }
  | {
      phase: 'answering';
      question: string;
      startedAt: number;
      retrieval: Retrieval;
      searchMs: number;
      /** Raw model text so far; '' while the model is still reading the prompt. */
      text: string;
    }
  | { phase: 'done'; question: string; startedAt: number; result: AskResult }
  | { phase: 'error'; question: string; message: string; retrieval?: Retrieval; text?: string }
  | { phase: 'cancelled'; question: string; retrieval?: Retrieval; text?: string };

export type AskAction =
  | { type: 'start'; question: string; at: number }
  | { type: 'event'; event: AskStreamEvent }
  | { type: 'fail'; message: string }
  | { type: 'cancel' };

export const initialState: AskState = { phase: 'idle' };

export const isBusy = (s: AskState) => s.phase === 'searching' || s.phase === 'answering';

const partial = (s: AskState) =>
  s.phase === 'answering' ? { retrieval: s.retrieval, text: s.text } : {};

export function askReducer(state: AskState, action: AskAction): AskState {
  switch (action.type) {
    case 'start':
      return { phase: 'searching', question: action.question, startedAt: action.at };

    case 'fail':
      if (!isBusy(state)) return state;
      return {
        phase: 'error',
        question: state.question,
        message: action.message,
        ...partial(state),
      };

    case 'cancel':
      if (!isBusy(state)) return state;
      return { phase: 'cancelled', question: state.question, ...partial(state) };

    case 'event': {
      if (!isBusy(state)) return state; // late events after stop / error
      const { event } = action;
      switch (event.type) {
        case 'retrieval':
          return {
            phase: 'answering',
            question: state.question,
            startedAt: state.startedAt,
            retrieval: event.retrieval,
            searchMs: event.timingsMs.search,
            text: '',
          };
        case 'delta':
          if (state.phase !== 'answering') return state;
          return { ...state, text: state.text + event.text };
        case 'done':
          // `done.result.answer` is authoritative: the deltas still carry `[n]` markers that point at
          // no source, which the server drops only in the final answer.
          return {
            phase: 'done',
            question: state.question,
            startedAt: state.startedAt,
            result: event.result,
          };
        case 'error':
          return {
            phase: 'error',
            question: state.question,
            message: event.error,
            ...partial(state),
          };
      }
    }
  }
}
