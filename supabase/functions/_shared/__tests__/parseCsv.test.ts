import { describe, it, expect } from 'vitest'
import { parseCsv, parseCsvWithHeaders } from '../parseCsv'

describe('parseCsv', () => {
  it('parses simple comma-separated rows', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })
  it('handles a quoted field containing a comma', () => {
    expect(parseCsv('name,note\n"Smith, John",hello\n')).toEqual([['name', 'note'], ['Smith, John', 'hello']])
  })
  it('handles an escaped double-quote inside a quoted field', () => {
    expect(parseCsv('note\n"she said ""hi"""\n')).toEqual([['note'], ['she said "hi"']])
  })
  it('handles a quoted field containing an embedded newline', () => {
    expect(parseCsv('note\n"line1\nline2"\n')).toEqual([['note'], ['line1\nline2']])
  })
  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('returns an empty array for empty input', () => {
    expect(parseCsv('')).toEqual([])
  })
})

describe('parseCsvWithHeaders', () => {
  it('maps each row to an object keyed by header, trimming cell whitespace', () => {
    const result = parseCsvWithHeaders('Name, Email\n Jane , jane@x.com \n')
    expect(result.headers).toEqual(['Name', 'Email'])
    expect(result.rows).toEqual([{ Name: 'Jane', Email: 'jane@x.com' }])
  })
  it('fills a missing trailing cell with an empty string rather than throwing', () => {
    const result = parseCsvWithHeaders('A,B,C\n1,2\n')
    expect(result.rows).toEqual([{ A: '1', B: '2', C: '' }])
  })
  it('returns empty headers and rows for an empty file', () => {
    expect(parseCsvWithHeaders('')).toEqual({ headers: [], rows: [] })
  })
})
