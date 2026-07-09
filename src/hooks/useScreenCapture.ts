import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'

interface CaptureState {
  isCapturing: boolean
  error: string | null
}

// Poll every 60 s so a background-tab timer throttle (Chrome/Safari cap timers
// to ~1 s intervals for inactive tabs) never kills the schedule.
const POLL_MS = 60_000
const MIN_MS  = 11 * 60 * 1000
const MAX_MS  = 18 * 60 * 1000

function randomDelay() {
  return MIN_MS + Math.floor(Math.random() * (MAX_MS - MIN_MS + 1))
}

export function useScreenCapture(onForcedClockOut: () => void) {
  const { user } = useAuth()
  const [state, setState] = useState<CaptureState>({ isCapturing: false, error: null })

  const streamRef       = useRef<MediaStream | null>(null)
  const videoRef        = useRef<HTMLVideoElement | null>(null)
  const canvasRef       = useRef<HTMLCanvasElement | null>(null)
  const intervalRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const nextCaptureTime = useRef<number>(0)   // epoch ms for next capture
  const busyRef         = useRef(false)        // prevent overlapping captures
  const userRef         = useRef(user)         // always-fresh user without stale closure

  useEffect(() => { userRef.current = user }, [user])

  // ── core capture routine ────────────────────────────────────────────────────
  // try/finally guarantees nextCaptureTime is ALWAYS rescheduled even when
  // upload fails, canvas throws (SecurityError / blank frame), or network errors.
  const doCapture = useCallback(async () => {
    if (busyRef.current) return
    if (!streamRef.current || !videoRef.current || !canvasRef.current || !userRef.current) return

    busyRef.current = true
    try {
      const video  = videoRef.current
      const canvas = canvasRef.current
      const u      = userRef.current

      canvas.width  = video.videoWidth  || 1280
      canvas.height = video.videoHeight || 720
      canvas.getContext('2d')?.drawImage(video, 0, 0)

      const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
      const base64  = dataUrl.split(',')[1]
      if (!base64) return    // blank/tainted canvas — reschedule via finally

      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
      const blob  = new Blob([bytes], { type: 'image/jpeg' })
      const path  = `${u.id}/${Date.now()}.jpg`

      const { error: uploadErr } = await supabase.storage
        .from('screenshots')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: false })

      if (uploadErr) {
        console.warn('[capture] upload error:', uploadErr.message)
        return    // finally still fires → rescheduled
      }

      const { data: signed, error: signErr } = await supabase.storage
        .from('screenshots')
        .createSignedUrl(path, 60 * 60 * 24 * 30)

      if (signErr || !signed?.signedUrl) {
        console.warn('[capture] signed URL error:', signErr?.message)
        return
      }

      const { error: insertErr } = await supabase.from('screenshots').insert({
        user_id:   u.id,
        url:       signed.signedUrl,
        timestamp: new Date().toISOString(),
        date:      new Date().toISOString().split('T')[0],
      })

      if (insertErr) console.warn('[capture] insert error:', insertErr.message)

    } catch (err) {
      console.error('[capture] unexpected error:', err)
    } finally {
      busyRef.current = false
      // Always reschedule — this is the only place the chain is set
      nextCaptureTime.current = Date.now() + randomDelay()
    }
  }, [])

  const doCaptureRef = useRef(doCapture)
  useEffect(() => { doCaptureRef.current = doCapture }, [doCapture])

  // ── stop ───────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
      videoRef.current.remove()
      videoRef.current = null
    }
    if (canvasRef.current) {
      canvasRef.current.remove()
      canvasRef.current = null
    }
    setState({ isCapturing: false, error: null })
  }, [])

  // ── start ──────────────────────────────────────────────────────────────────
  const start = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' } as MediaTrackConstraints,
      })

      streamRef.current = stream

      if (!videoRef.current) {
        videoRef.current = document.createElement('video')
        videoRef.current.style.cssText =
          'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px'
        document.body.appendChild(videoRef.current)
      }
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas')
        canvasRef.current.style.cssText =
          'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px'
        document.body.appendChild(canvasRef.current)
      }

      videoRef.current.srcObject = stream
      try {
        await videoRef.current.play()
      } catch {
        // Some environments block autoplay — getDisplayMedia stream still works
      }

      stream.getVideoTracks()[0].onended = () => {
        stop()
        onForcedClockOut()
      }

      // Schedule first capture ~1 s after start (gives video time for first frame)
      nextCaptureTime.current = Date.now() + 1000

      // 60-second polling interval — survives background-tab throttling
      intervalRef.current = setInterval(() => {
        if (Date.now() >= nextCaptureTime.current) {
          void doCaptureRef.current()
        }
      }, POLL_MS)

      // Fire an extra tick at 1.2 s so the first screenshot is captured promptly
      // without waiting up to 60 s for the first interval tick
      setTimeout(() => {
        if (Date.now() >= nextCaptureTime.current) {
          void doCaptureRef.current()
        }
      }, 1200)

      setState({ isCapturing: true, error: null })
      return true
    } catch {
      setState({ isCapturing: false, error: 'Screen sharing was cancelled.' })
      return false
    }
  }, [stop, onForcedClockOut])

  // ── cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
      if (videoRef.current) { videoRef.current.remove(); videoRef.current = null }
      if (canvasRef.current) { canvasRef.current.remove(); canvasRef.current = null }
    }
  }, [])

  return { ...state, start, stop }
}
