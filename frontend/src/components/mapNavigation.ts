/** Preserve a research result and network layers while selecting another map card. */
export function mapExtras(params: URLSearchParams, companyId?: number): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key of ['agent_ids', 'layers', 'network', 'network_other', 'agent_view']) {
    const value = params.get(key)
    if (value) result[key] = value
  }
  if (companyId != null) result.co = String(companyId)
  return result
}
