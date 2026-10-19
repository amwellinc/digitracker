// Shared GHL (HighLevel) API client for Data Agent server-side functions.
// Consumed by data-agent-test-connection (Task 5), the schema-cache
// refresher (Task 5), and Task 8/15's upload-analysis and migration-worker
// flows. Keep this the single place that knows GHL's base URL, API
// version, and request/response shapes for the endpoints Data Agent uses.
const GHL_BASE_URL = 'https://services.leadconnectorhq.com'
const GHL_API_VERSION = '2021-07-28'

export interface GhlClientConfig { pit: string; locationId: string }

export class GhlRateLimitError extends Error {}

async function ghlFetch(config: GhlClientConfig, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${GHL_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${config.pit}`,
      Version: GHL_API_VERSION,
      'Content-Type': 'application/json',
    },
  })
}

async function assertOk(res: Response, label: string): Promise<void> {
  if (res.status === 429) throw new GhlRateLimitError(`${label}: rate limited`)
  if (!res.ok) throw new Error(`${label} failed: ${res.status} ${await res.text()}`)
}

export interface GhlCustomField { id: string; fieldKey: string; name: string; dataType: string }

export async function fetchContactCustomFields(config: GhlClientConfig): Promise<GhlCustomField[]> {
  const res = await ghlFetch(config, `/locations/${config.locationId}/customFields?model=contact`)
  await assertOk(res, 'GHL customFields fetch')
  const body = await res.json() as { customFields?: GhlCustomField[] }
  return body.customFields ?? []
}

export interface GhlObjectSchema { key: string; labels: { singular: string; plural: string }; fields: GhlCustomField[] }

export async function fetchCustomObjects(config: GhlClientConfig): Promise<GhlObjectSchema[]> {
  const listRes = await ghlFetch(config, `/objects/?locationId=${config.locationId}`)
  await assertOk(listRes, 'GHL objects list')
  const listBody = await listRes.json() as { objects?: { key: string; labels: { singular: string; plural: string } }[] }
  const schemas: GhlObjectSchema[] = []
  for (const obj of listBody.objects ?? []) {
    const detailRes = await ghlFetch(config, `/objects/${obj.key}?locationId=${config.locationId}`)
    await assertOk(detailRes, `GHL object detail (${obj.key})`)
    const detail = await detailRes.json() as { object?: { fields?: GhlCustomField[] } }
    schemas.push({ key: obj.key, labels: obj.labels, fields: detail.object?.fields ?? [] })
  }
  return schemas
}

export interface GhlUpsertContactPayload {
  locationId: string
  email?: string
  phone?: string
  firstName?: string
  lastName?: string
  tags?: string[]
  customFields?: { id: string; value: string }[]
}
export interface GhlUpsertContactResult { contact: { id: string }; new: boolean }

export async function upsertContact(config: GhlClientConfig, payload: GhlUpsertContactPayload): Promise<GhlUpsertContactResult> {
  const res = await ghlFetch(config, '/contacts/upsert', { method: 'POST', body: JSON.stringify(payload) })
  await assertOk(res, 'GHL contact upsert')
  return await res.json() as GhlUpsertContactResult
}

export async function getContact(config: GhlClientConfig, contactId: string): Promise<{ contact: Record<string, unknown> }> {
  const res = await ghlFetch(config, `/contacts/${contactId}`)
  await assertOk(res, 'GHL contact fetch')
  return await res.json()
}

export async function deleteContact(config: GhlClientConfig, contactId: string): Promise<void> {
  const res = await ghlFetch(config, `/contacts/${contactId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) await assertOk(res, 'GHL contact delete')
}

export interface GhlObjectRecord { id: string; properties: Record<string, unknown> }

export async function searchObjectRecord(config: GhlClientConfig, objectKey: string, matchField: string, matchValue: string): Promise<GhlObjectRecord | null> {
  const res = await ghlFetch(config, `/objects/${objectKey}/records/search`, {
    method: 'POST',
    body: JSON.stringify({ locationId: config.locationId, page: 1, pageLimit: 1, searchFilter: `${matchField}:${matchValue}` }),
  })
  await assertOk(res, 'GHL object search')
  const body = await res.json() as { records?: GhlObjectRecord[] }
  return body.records?.[0] ?? null
}

export async function createObjectRecord(config: GhlClientConfig, objectKey: string, properties: Record<string, unknown>): Promise<GhlObjectRecord> {
  const res = await ghlFetch(config, `/objects/${objectKey}/records`, { method: 'POST', body: JSON.stringify({ locationId: config.locationId, properties }) })
  await assertOk(res, 'GHL object create')
  const body = await res.json() as { record: GhlObjectRecord }
  return body.record
}

export async function updateObjectRecord(config: GhlClientConfig, objectKey: string, recordId: string, properties: Record<string, unknown>): Promise<GhlObjectRecord> {
  const res = await ghlFetch(config, `/objects/${objectKey}/records/${recordId}`, { method: 'PUT', body: JSON.stringify({ properties }) })
  await assertOk(res, 'GHL object update')
  const body = await res.json() as { record: GhlObjectRecord }
  return body.record
}

export async function deleteObjectRecord(config: GhlClientConfig, objectKey: string, recordId: string): Promise<void> {
  const res = await ghlFetch(config, `/objects/${objectKey}/records/${recordId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) await assertOk(res, 'GHL object delete')
}

export async function getObjectRecord(config: GhlClientConfig, objectKey: string, recordId: string): Promise<GhlObjectRecord> {
  const res = await ghlFetch(config, `/objects/${objectKey}/records/${recordId}`)
  await assertOk(res, 'GHL object record fetch')
  const body = await res.json() as { record: GhlObjectRecord }
  return body.record
}

export async function searchContactByEmail(config: GhlClientConfig, value: string): Promise<{ id: string; fields: Record<string, unknown> } | null> {
  const res = await ghlFetch(config, `/contacts/?locationId=${config.locationId}&query=${encodeURIComponent(value)}`)
  await assertOk(res, 'GHL contact search')
  const body = await res.json() as { contacts?: { id: string; email?: string; phone?: string }[] }
  // Only trust an EXACT match on the value actually being searched for
  // (this function is called with either an email or a phone number) —
  // GHL's query search can return multiple or near-matching results, and
  // blindly taking contacts[0] risked treating a DIFFERENT real contact
  // as the one being migrated, which later made undo delete or overwrite
  // that unrelated contact instead of the one this row actually touched.
  const matched = body.contacts?.find(c => c.email === value || c.phone === value)
  if (!matched) return null
  const detail = await getContact(config, matched.id)
  return { id: matched.id, fields: detail.contact }
}
