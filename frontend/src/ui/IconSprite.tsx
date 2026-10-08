/** SVG sprite with every icon of the app; render once near the root, use via <Icon>. */
export function IconSprite() {
  const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="i-search" viewBox="0 0 24 24" {...line}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></symbol>
        <symbol id="i-pin" viewBox="0 0 24 24" {...line}><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></symbol>
        <symbol id="i-bookmark" viewBox="0 0 24 24" {...line}><path d="M6 3.5h12v17l-6-4-6 4z" /></symbol>
        <symbol id="i-list" viewBox="0 0 24 24" {...line}><path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" /></symbol>
        <symbol id="i-map" viewBox="0 0 24 24" {...line}><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></symbol>
        <symbol id="i-check" viewBox="0 0 24 24" {...line} strokeWidth={2.2}><path d="M5 12.5l4.5 4.5L19 7.5" /></symbol>
        <symbol id="i-x" viewBox="0 0 24 24" {...line} strokeWidth={1.9}><path d="M6 6l12 12M18 6L6 18" /></symbol>
        <symbol id="i-sun" viewBox="0 0 24 24" {...line}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" /></symbol>
        <symbol id="i-moon" viewBox="0 0 24 24" {...line}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></symbol>
        <symbol id="i-factory" viewBox="0 0 24 24" {...line} strokeWidth={2}><path d="M3 20V10l5 3.5V10l5 3.5V6h7v14z" /></symbol>
        <symbol id="i-external" viewBox="0 0 24 24" {...line} strokeWidth={1.9}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></symbol>
        <symbol id="i-grid" viewBox="0 0 24 24" {...line}><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></symbol>
        <symbol id="i-briefcase" viewBox="0 0 24 24" {...line}><rect x="3" y="7.5" width="18" height="12.5" rx="3" /><path d="M8.5 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v2M3 13h18" /></symbol>
        <symbol id="i-heat" viewBox="0 0 24 24" {...line}><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="M3.5 9.2h17M3.5 14.8h17M9.2 3.5v17M14.8 3.5v17" /></symbol>
        <symbol id="i-bell" viewBox="0 0 24 24" {...line}><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></symbol>
        <symbol id="i-drone" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.4 5.2 8.1 9.1-1.2.9-6.2-3.4-.5 4.4 2.4 2.2-.6 1.1L12 20.7 8.6 22l-.6-1.1 2.4-2.2-.5-4.4-6.2 3.4-1.2-.9 8.1-9.1z" /></symbol>
        <symbol id="i-tank" viewBox="0 0 24 24" fill="currentColor"><path d="M8 8h6.5l1 2H22v1.4h-6.5V12H18l1.5 2.5H4.5L6 12h1.5zM3.5 15.5h17a2.5 2.5 0 0 1 0 5h-17a2.5 2.5 0 0 1 0-5zm1.5 1.6a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zm4 0a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zm4 0a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zm4 0a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8z" /></symbol>
        <symbol id="i-expand" viewBox="0 0 24 24" {...line} strokeWidth={1.9}><path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5" /></symbol>
        <symbol id="i-globe" viewBox="0 0 24 24" {...line}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z" /></symbol>
        <symbol id="i-spark" viewBox="0 0 24 24" {...line} strokeWidth={1.8}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></symbol>
        <symbol id="i-send" viewBox="0 0 24 24" {...line} strokeWidth={2}><path d="M12 19V5M6 11l6-6 6 6" /></symbol>
        <symbol id="i-graph" viewBox="0 0 24 24" {...line}><circle cx="5" cy="12" r="2.5" /><circle cx="19" cy="5" r="2.5" /><circle cx="19" cy="19" r="2.5" /><path d="M7.3 11l9.4-5M7.3 13l9.4 5" /></symbol>
        <symbol id="i-chev" viewBox="0 0 24 24" {...line} strokeWidth={2}><path d="M9 6l6 6-6 6" /></symbol>
        <symbol id="i-download" viewBox="0 0 24 24" {...line} strokeWidth={1.9}><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" /></symbol>
        <symbol id="i-doc" viewBox="0 0 24 24" {...line}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></symbol>
      </defs>
    </svg>
  )
}
