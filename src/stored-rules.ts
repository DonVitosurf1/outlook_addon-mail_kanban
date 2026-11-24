/** Ablageregeln aus `outlook-kanban-ai-rules-v1`. Unlesbarer Speicher bleibt unangetastet. */
export function readStoredRules(raw: string | null): { items: unknown[] } | undefined {
  if (!raw) return undefined
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
    const items = (data as { items?: unknown }).items
    if (!Array.isArray(items)) return undefined
    return data as { items: unknown[] }
  } catch {
    return undefined
  }
}
