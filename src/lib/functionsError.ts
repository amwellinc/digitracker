// supabase.functions.invoke() throws a generic "Edge Function returned a
// non-2xx status code" on any error response — the JSON { error: "..." }
// body our edge functions actually return only lives on error.context (a
// Response), which has to be parsed separately to surface the real reason.
export async function extractFunctionError(error: unknown, data: unknown): Promise<string | undefined> {
  if (!error) return (data as { error?: string } | null)?.error
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json() as { error?: string }
      if (body?.error) return body.error
    } catch {
      // fall through to generic message below
    }
  }
  return (error as { message?: string }).message ?? 'Request failed.'
}
