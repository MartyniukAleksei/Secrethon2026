type Value = string | number | boolean | null | undefined

// Excel only reads UTF-8 (and so Cyrillic) correctly when the file starts with a BOM.
const BOM = '﻿'

const cell = (v: Value) => {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV in the same shape as the server export: header row, UTF-8 with BOM. */
export function toCsv<T>(rows: T[], columns: (keyof T & string)[]): string {
  const lines = [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c] as Value)).join(','))]
  return BOM + lines.join('\n') + '\n'
}

export function toJson<T>(rows: T[], columns: (keyof T & string)[]): string {
  const items = rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])))
  return JSON.stringify({ items }, null, 2)
}

export function downloadText(filename: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
