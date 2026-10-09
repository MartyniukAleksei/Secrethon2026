import L from 'leaflet'

// leaflet.markercluster extends the global `L`; import this module before it.
;(window as unknown as { L: typeof L }).L = L
