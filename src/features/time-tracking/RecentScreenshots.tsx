import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Screenshot } from '@/types'

export function RecentScreenshots({ userId }: { userId: string }) {
  const [shots, setShots] = useState<Screenshot[]>([])
  const [lightbox, setLightbox] = useState<Screenshot | null>(null)

  useEffect(() => {
    if (!userId) return
    const today = new Date().toISOString().split('T')[0]
    void supabase
      .from('screenshots')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .order('timestamp', { ascending: false })
      .limit(6)
      .then(({ data }) => setShots((data ?? []) as Screenshot[]))
  }, [userId])

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="font-semibold text-gray-900">Recent Screenshots</h3>
      <p className="text-sm text-gray-400 mt-0.5">Automatically captured every 10–18 minutes</p>

      {shots.length === 0 ? (
        <div className="h-28 flex items-center justify-center text-sm text-gray-300 mt-4">
          No screenshots yet today
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 mt-4">
          {shots.map(s => (
            <button
              key={s.id}
              onClick={() => setLightbox(s)}
              className="aspect-video bg-gray-100 rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
            >
              <img src={s.url} alt="Screenshot" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="max-w-4xl w-full">
            <img src={lightbox.url} alt="Screenshot" className="w-full rounded-xl shadow-2xl" />
            <p className="text-white text-sm text-center mt-3 opacity-70">
              {new Date(lightbox.timestamp).toLocaleString()}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
