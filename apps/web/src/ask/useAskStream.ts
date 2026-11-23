import { useCallback, useEffect, useReducer, useRef } from 'react';
import { AskHttpError, askStream } from '../api/ask-stream';
import { askReducer, initialState } from './state';

/**
 * Runs one question at a time against `POST /ask/stream`. A new question, `stop()` or unmounting
 * aborts the request in flight — the closed connection makes the server stop generating, so a
 * forgotten tab does not keep the model (or a paid API) busy.
 */
export function useAskStream() {
  const [state, dispatch] = useReducer(askReducer, initialState);
  const current = useRef<AbortController | null>(null);

  const ask = useCallback(async (question: string) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    // Events of an aborted run may still be in flight; only the latest run may touch the state.
    const live = () => current.current === controller && !controller.signal.aborted;

    dispatch({ type: 'start', question, at: performance.now() });
    try {
      for await (const event of askStream(question, controller.signal)) {
        if (!live()) break;
        dispatch({ type: 'event', event });
      }
    } catch (err) {
      if (!live()) return;
      dispatch({ type: 'fail', message: describe(err) });
    } finally {
      if (current.current === controller) current.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    current.current?.abort();
    current.current = null;
    dispatch({ type: 'cancel' });
  }, []);

  useEffect(() => () => current.current?.abort(), []);

  return { state, ask, stop };
}

function describe(err: unknown): string {
  if (err instanceof AskHttpError) {
    return err.status >= 500 ? `The API is unavailable (${err.message}).` : err.message;
  }
  // fetch rejects with a TypeError when the network or the dev proxy is down.
  if (err instanceof TypeError) return 'Could not reach the API.';
  return err instanceof Error ? err.message : String(err);
}
