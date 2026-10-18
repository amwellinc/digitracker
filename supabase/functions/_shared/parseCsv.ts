// supabase/functions/_shared/parseCsv.ts
// Zero-import, zero-dependency RFC4180-ish CSV parser. No library in
// package.json does this, and pulling one in for a single parser was
// judged unnecessary (YAGNI) given this project's own exports are never
// more than a few thousand rows.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const len = text.length
  while (i < len) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i += 1; continue
      }
      field += char; i += 1; continue
    }
    if (char === '"') { inQuotes = true; i += 1; continue }
    if (char === ',') { row.push(field); field = ''; i += 1; continue }
    if (char === '\r') { i += 1; continue }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue }
    field += char; i += 1
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter(r => !(r.length === 1 && r[0] === ''))
}

export interface ParsedCsv { headers: string[]; rows: Record<string, string>[] }

export function parseCsvWithHeaders(text: string): ParsedCsv {
  const raw = parseCsv(text)
  if (raw.length === 0) return { headers: [], rows: [] }
  const headers = raw[0].map(h => h.trim())
  const rows = raw.slice(1).map(cols => {
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => { obj[h] = (cols[idx] ?? '').trim() })
    return obj
  })
  return { headers, rows }
}
