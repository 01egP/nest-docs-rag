/**
 * End-to-end check of the provider wiring, no database involved:
 * embed a question and two passages, rank them, then ask the chat model for a JSON answer.
 *   npm run smoke
 */
import { loadConfig } from '../config.js';
import { createEmbedder, createGenerator } from '../providers/index.js';

const config = loadConfig();
const embedder = createEmbedder(config);
const generator = createGenerator(config);

const question = 'How do I protect a route so only authorized users can call it?';
const passages = [
  'Guards determine whether a given request will be handled by the route handler, depending on permissions, roles or ACLs.',
  'Pipes transform input data to the desired form and validate it before it reaches the handler.',
];

// Vectors are L2-normalized, so the dot product is the cosine similarity.
const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);

let t = performance.now();
const [[q], docs] = await Promise.all([
  embedder.embed([question], 'query'),
  embedder.embed(passages, 'document'),
]);
console.log(
  `${embedder.id} (dim ${embedder.dimensions}) — ${Math.round(performance.now() - t)} ms`,
);
passages.forEach((p, i) => console.log(`  ${dot(q!, docs[i]!).toFixed(3)}  ${p.slice(0, 60)}…`));

t = performance.now();
const result = await generator.generate({
  messages: [
    { role: 'system', content: 'Answer only from the numbered passages. Cite passage numbers.' },
    {
      role: 'user',
      content: `${passages.map((p, i) => `[${i + 1}] ${p}`).join('\n')}\n\nQuestion: ${question}`,
    },
  ],
  jsonSchema: {
    type: 'object',
    properties: {
      answer: { type: 'string' },
      citations: { type: 'array', items: { type: 'integer' } },
    },
    required: ['answer', 'citations'],
  },
});
console.log(`\n${generator.id} — ${Math.round(performance.now() - t)} ms`, result.usage);
console.log(JSON.parse(result.text));
