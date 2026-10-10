import assert from 'node:assert/strict'
import { mapExtras, markerLocation } from '../src/components/mapNavigation.ts'
import { companyLocation } from '../src/components/mapCamera.ts'
import { mapActionHref } from '../src/features/agent/mapActions.ts'

const params = new URLSearchParams('co=7&layers=parent&marker_lat=1&marker_lng=2')
const spot = { lat: 55.75, lng: 37.61 }
const clicked = new URLSearchParams(mapExtras(params, 7, spot))
assert.deepEqual(markerLocation(clicked, 7), spot)
assert.equal(markerLocation(clicked, 8), undefined)
// Selecting from the list (including the same company) resets the clicked location.
assert.equal(markerLocation(new URLSearchParams(mapExtras(clicked, 7)), 7), undefined)
assert.equal(mapExtras(clicked, 8).marker_lat, undefined)
assert.equal(mapExtras(clicked).co, undefined)
assert.equal(mapExtras(params, 7, spot).layers, 'parent')
for (const lat of ['', 'NaN', '91', 'Infinity']) {
  assert.equal(markerLocation(new URLSearchParams(`co=7&marker_lng=2&marker_lat=${lat}`), 7), undefined)
}
const head = { employer_id: 7, kind: 'head_office', lat: 60, lng: 30 }
const hiring = { employer_id: 7, lat: 55, lng: 37, vacancies: 12 }
assert.equal(companyLocation([hiring], [head], 7), head)
assert.equal(companyLocation([hiring], [], 7), hiring)
const agentFocus = new URL(mapActionHref({ kind: 'focus_company', employer_id: 7 }), 'http://localhost')
assert.equal(agentFocus.searchParams.get('co'), '7')
assert.equal(markerLocation(agentFocus.searchParams, 7), undefined)
assert.equal(agentFocus.searchParams.get('network'), null)
console.log('Marker navigation, reset, validation and headquarters fallback: OK')
