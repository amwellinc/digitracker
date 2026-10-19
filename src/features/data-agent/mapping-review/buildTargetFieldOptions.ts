export interface CachedGhlField { id: string; fieldKey: string; name: string; dataType: string }
export interface TargetFieldOption { key: string; label: string; type: 'standard' | 'custom' }

const STANDARD_CONTACT_FIELDS: TargetFieldOption[] = [
  { key: 'firstName', label: 'First Name', type: 'standard' },
  { key: 'lastName', label: 'Last Name', type: 'standard' },
  { key: 'email', label: 'Email', type: 'standard' },
  { key: 'phone', label: 'Phone', type: 'standard' },
  { key: 'companyName', label: 'Company Name', type: 'standard' },
  { key: 'address1', label: 'Address', type: 'standard' },
  { key: 'city', label: 'City', type: 'standard' },
  { key: 'state', label: 'State', type: 'standard' },
  { key: 'postalCode', label: 'Postal Code', type: 'standard' },
  { key: 'country', label: 'Country', type: 'standard' },
  { key: 'website', label: 'Website', type: 'standard' },
]

// Mirrors supabase/functions/_shared/dataAgentUploadPlanner.ts's
// buildTargetFields() exactly — duplicated rather than shared because
// this file runs in the Vite/browser bundle and that one runs in Deno,
// two separate module runtimes that can't import from each other. The
// cache's raw {id, fieldKey, name} shape is NOT interchangeable with
// TargetFieldOption (different property names entirely), and GHL's
// standard fields need to be supplied from the hardcoded list above
// since nothing ever caches them — found during a final whole-branch
// review: this page was casting the raw cache shape directly as if it
// already matched TargetFieldOption, so every dropdown option rendered
// with an undefined key/label and no standard fields were ever offered.
export function buildTargetFieldOptions(objectType: string, cachedFields: CachedGhlField[]): TargetFieldOption[] {
  const customFields: TargetFieldOption[] = cachedFields.map(f => ({ key: f.id, label: f.name, type: 'custom' }))
  return objectType === 'contact' ? [...STANDARD_CONTACT_FIELDS, ...customFields] : customFields
}
