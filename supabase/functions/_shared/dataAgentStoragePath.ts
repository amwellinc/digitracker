// Validates a Data Agent upload's storagePath before it's handed to a
// service-role-authenticated storage download. storage-js builds that
// request's URL by plain string concatenation (bucket + "/" + path, no
// encoding, no dot-segment check), and standard URL path normalization
// then collapses "../" or "%2e%2e" segments before the request goes out —
// so a path that merely *starts with* "<subAccount>/" can still smuggle a
// traversal sequence past that prefix and reach a different storage
// bucket, or even the project's REST/Auth API, with the service role's
// full privileges. The only legitimate shape, set by
// src/features/data-agent/upload/NewMigrationModal.tsx, is exactly
// "<subAccount>/<uuid>-<filename>" — one "/" total, nothing after it that
// a URL parser would treat structurally.
export function isValidDataAgentStoragePath(storagePath: string, subAccount: string): boolean {
  const prefix = `${subAccount}/`
  if (!storagePath.startsWith(prefix)) return false
  const rest = storagePath.slice(prefix.length)
  if (rest.length === 0) return false
  if (/[/\\%?#]/.test(rest)) return false
  if (rest.includes('..')) return false
  return true
}
