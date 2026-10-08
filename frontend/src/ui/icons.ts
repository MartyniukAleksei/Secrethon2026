export const ICON_NAMES = [
  'search', 'pin', 'bookmark', 'list', 'map', 'check', 'x', 'sun', 'moon', 'factory', 'external',
  'grid', 'briefcase', 'heat', 'bell', 'drone', 'tank', 'expand', 'globe', 'spark', 'send', 'graph',
  'chev', 'doc', 'download',
] as const

export type IconName = (typeof ICON_NAMES)[number]
