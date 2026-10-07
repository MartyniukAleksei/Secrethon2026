export type AgentSource = { id: string; title: string; url: string; published_at?: string | null }
export type AgentRow = { id: string | number | null; label: string; value: number | null; vacancies: number; salary_samples: number; source_id?: string }
export type AgentScope = { days: number | null; region_id: number | null; category: string | null; as_of: string | null; active_only: boolean }
export type DataArtifact = { id: string; kind: 'table' | 'bar' | 'line'; title: string; unit: string; rows: AgentRow[]; scope: AgentScope }
export type MentionsArtifact = { id: string; kind: 'mentions'; title: string; days: number; items: { source_id: string; title: string; url: string; text: string; published_at: string | null }[] }
export type RelationsArtifact = { id: string; kind: 'relations'; title: string; company: string; items: { name: string; kind: string; direction: string; employer_id: number | null }[] }
export type AgentArtifact = DataArtifact | MentionsArtifact | RelationsArtifact
export type AgentResponse = { text: string; sources: AgentSource[]; artifacts: AgentArtifact[]; as_of: string | null; tools_used: string[] }
export type AgentRequest = { message: string; history: { role: 'user' | 'assistant'; text: string }[]; context: { company_id?: number; region_id?: number; category?: string; days: number } }

export async function sendAgentRequest(payload: AgentRequest, signal: AbortSignal): Promise<AgentResponse> {
  const response = await fetch('/api/agent/chat', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(typeof error?.detail === 'string' ? error.detail : 'Не вдалося отримати відповідь агента. Спробуйте ще раз.')
  }
  return await response.json() as AgentResponse
}
