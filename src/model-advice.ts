/** Grobe Zuordnung nach Grafikspeicher (A3). Das Board lädt nichts herunter. */
export type Advice = {memory:string; chat:string; embedding:string}

export const ADVICE: Advice[] = [
  {memory:'8 GB', chat:'llama3.1:8b', embedding:'qwen3-embedding:0.6b'},
  {memory:'12 GB', chat:'qwen2.5:14b', embedding:'qwen3-embedding:0.6b'},
  {memory:'24 GB', chat:'qwen2.5:32b', embedding:'qwen3-embedding:0.6b'},
]

export function advicePull(row: Advice, kind: 'chat'|'embedding'): string {
  return 'ollama pull '+(kind==='chat' ? row.chat : row.embedding)
}
