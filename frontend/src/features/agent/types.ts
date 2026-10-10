export type Bounds = { west: number; south: number; east: number; north: number }
export type MapView = {
  bounds: Bounds | null; search: string; sanctioned: boolean; specialization: 'all' | 'uav' | 'weapons'
  hidden_categories: string[]; layers: ('supplier' | 'parent')[]
  network_company_id: number | null; network_kinds: ('supplier' | 'parent' | 'related' | 'bank' | 'successor' | 'branch')[]; visible_count: number; result_ids: number[]
}
export type AgentTarget = 'company' | 'viewport' | 'filters' | 'selection'
export type AgentMapScope = { mode: 'viewport' | 'filters' | 'selection'; bounds: Bounds | null; employer_ids: number[]; filters: Omit<MapView, 'bounds' | 'visible_count'> & { region: string[]; focus: string[]; domain: string[]; role: string[] } }
export type AgentPageContext = { page?: 'map' | 'other'; company_id?: number; region_id?: number; category?: string; days: number; map_scope?: AgentMapScope }
export type ScopeTotals = { employers: number; vacancies: number; salary_samples: number; median_salary: number | null }
export type AgentSource = { id: string; title: string; url: string; published_at?: string | null; origin?: 'database' | 'public_web'; retrieved_at?: string; excerpt?: string | null; verification?: string }
export type AgentSection = { kind: 'database' | 'public_web' | 'analysis'; text: string; source_ids: string[] }
export type ResultAction = { kind: 'show_companies'; employer_ids: number[] } | { kind: 'show_relations'; employer_id: number }
export type MapAction = { kind: 'focus_company' | 'show_relations' | 'show_hiring_places'; employer_id: number; employer_ids?: number[]; places?: { employer_id: number; lat: number; lng: number }[] }
export type AgentRow = {
  id: string | number | null; label: string; value: number | null; vacancies: number; salary_samples: number; source_id?: string
  domain?: string; median_salary?: number | null; recent_30d?: number; share?: number; trend?: number[]
  lower?: number; upper?: number; unit?: string; outlier_salaries?: number
}
export type AgentScope = { days: number | null; region_id: number | null; category: string | null; as_of: string | null; active_only: boolean; map_scope?: AgentMapScope | null; totals?: ScopeTotals | null }
export type AgentColumn = { key: keyof AgentRow; label: string; format: 'number' | 'money' | 'percent' | 'text' | 'domain' | 'company' | 'spark' }
export type DataArtifact = {
  id: string; kind: 'table' | 'bar' | 'line' | 'donut' | 'stacked' | 'heatmap' | 'scatter' | 'histogram' | 'kpi' | 'signals'
  title: string; unit: string; rows: AgentRow[]; scope: AgentScope; columns?: AgentColumn[]; note?: string; source_id?: string; companion_id?: string
  stats?: { vacancies: number; employers: number; regions: number; salary_samples: number; confirmed: number; likely: number; quartiles: (number | null)[] | null }
}
export type MentionsArtifact = { id: string; kind: 'mentions'; title: string; days: number; items: { source_id: string; title: string; url: string; text: string; published_at: string | null }[] }
export type RelationsArtifact = { id: string; kind: 'relations'; title: string; company: string; employer_id?: number; total?: number; items: { name: string; kind: string; direction: string; employer_id: number | null; source_id?: string | null }[] }
export type AgentArtifact = DataArtifact | MentionsArtifact | RelationsArtifact
export type WebAccess = 'ask' | 'allowed' | 'db_only'
export type WebPermission = { company: string; days: number }
export type AgentResponse = { text: string; sources: AgentSource[]; artifacts: AgentArtifact[]; as_of: string | null; tools_used: string[]; sections?: AgentSection[]; actions?: ResultAction[]; map_action?: MapAction | null; context?: AgentPageContext; scope_totals?: ScopeTotals | null; evidence?: unknown[]; generated_at?: string; web_permission?: WebPermission }
export type AgentRequest = { message: string; history: { role: 'user' | 'assistant'; text: string }[]; context: AgentPageContext; web_access?: WebAccess; approved_context?: string[] }

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
