/**
 * Cross-encoder reranker run in-process with transformers.js (ONNX Runtime), since Ollama has no
 * rerank endpoint. Default model: bge-reranker-v2-m3 — multilingual, the reranking pair of bge-m3.
 * The model is downloaded from Hugging Face on first use into MODELS_DIR (git-ignored).
 */
import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  env,
  type DataType,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from '@huggingface/transformers';
import type { Reranker } from '../types.js';

// Pairs are scored one per forward pass, not batched. Batching pads every pair to the longest one,
// and with the int8 model (dynamic quantization: activation scales are computed over the whole
// batch) a pair's score then depends on its batch-mates. On 30 candidates batch 1 was not slower.

/** bge-reranker-v2-m3 is trained for pairs up to 512 tokens; longer ones are cut from the end. */
const MAX_TOKENS = 512;

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export class TransformersReranker implements Reranker {
  readonly id: string;
  private loaded?: Promise<{ tokenizer: PreTrainedTokenizer; model: PreTrainedModel }>;

  constructor(
    readonly model: string,
    private readonly dtype: DataType,
    cacheDir: string,
  ) {
    this.id = `transformers:${model}`;
    env.cacheDir = cacheDir;
  }

  async score(query: string, documents: string[]): Promise<number[]> {
    const { tokenizer, model } = await this.load();
    const scores: number[] = [];
    for (const document of documents) {
      const inputs = tokenizer(query, {
        text_pair: document,
        truncation: true,
        max_length: MAX_TOKENS,
      });
      // One logit per pair ("relevant"); sigmoid maps it to [0, 1] as in the model card.
      const { logits } = await model(inputs);
      scores.push(sigmoid((logits.data as Float32Array)[0]!));
    }
    return scores;
  }

  private load() {
    this.loaded ??= Promise.all([
      AutoTokenizer.from_pretrained(this.model),
      AutoModelForSequenceClassification.from_pretrained(this.model, { dtype: this.dtype }),
    ]).then(([tokenizer, model]) => ({ tokenizer, model }));
    return this.loaded;
  }
}
