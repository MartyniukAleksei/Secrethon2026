import type { ApiSupplyChain } from '../../api/types'

/** Colour of a weapon category; anything else (a peer estimate) is grey. */
export const focusColor = (focus: string | null | undefined) =>
  focus === 'drone' || focus === 'missile' || focus === 'kab' ? `var(--focus-${focus})` : 'var(--focus-peer)'

/** Number of supply links of every kind. */
export const supplyCount = (chain: ApiSupplyChain | null | undefined) =>
  chain ? chain.bom.length + chain.lead.length + chain.cooperation.length + chain.claims.length : 0
