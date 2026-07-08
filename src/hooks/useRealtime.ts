import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

interface Options {
  table: string
  filter?: string
  onInsert?: (row: Record<string, unknown>) => void
  onUpdate?: (row: Record<string, unknown>) => void
  onDelete?: (row: Record<string, unknown>) => void
}

export function useRealtime({ table, filter, onInsert, onUpdate, onDelete }: Options) {
  useEffect(() => {
    const channel = supabase
      .channel(`rt:${table}:${filter ?? 'all'}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter },
        p => onInsert?.(p.new as Record<string, unknown>))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter },
        p => onUpdate?.(p.new as Record<string, unknown>))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table, filter },
        p => onDelete?.(p.old as Record<string, unknown>))
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [table, filter, onInsert, onUpdate, onDelete])
}
