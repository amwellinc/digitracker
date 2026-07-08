import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'

interface CaptureState {
  isCapturing: boolean
  error: string | null
}

const MIN_MS = 11 * 60 * 1000
const MAX_MS = 18 * 60 * 1000

function randomMs() {
  return Math.floor(Math.random() * (MAX_MS - MIN_MS + 1)) + MIN_MS
}

export function useScreenCapture(onForcedClockOut: () => void) {
  const { user } = useAuth()
  const [state, setState] = useState<CaptureState>({ isCapturing: false, error: null })
  const streamRef = useRef<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Ref-based indirection so that scheduleNext never closes over a stale captureAndUpload,
  // and captureAndUpload never closes over a stale scheduleNext.
  const captureAndUploadRef = useRef<(() => Promise<void>) | null>(null)
  const scheduleNextRef = useRef<(() => void) | null>(null)

  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      void captureAndUploadRef.current?.()
    }, randomMs())
  }, []) // stable — captureAndUploadRef identity never changes

  // Keep scheduleNext ref in sync
  useEffect(() => {
    scheduleNextRef.current = scheduleNext
  }, [scheduleNext])

  const captureAndUpload = useCallback(async () => {
    if (!streamRef.current || !videoRef.current || !canvasRef.current || !user) return

    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    canvas.getContext('2d')?.drawImage(video, 0, 0)

    const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
    const base64 = dataUrl.split(',')[1]
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: 'image/jpeg' })

    const path = `${user.id}/${Date.now()}.jpg`
    const { error: uploadErr } = await supabase.storage
      .from('screenshots')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false })

    if (uploadErr) {
      scheduleNextRef.current?.()
      return
    }

    const { data: { publicUrl } } = supabase.storage.from('screenshots').getPublicUrl(path)
    const today = new Date().toISOString().split('T')[0]

    const { error: insertErr } = await supabase.from('screenshots').insert({
      user_id: user.id,
      url: publicUrl,
      date: today,
    })

    if (insertErr) {
      console.error('[useScreenCapture] Failed to record screenshot:', insertErr.message)
    }

    scheduleNextRef.current?.()
  }, [user]) // only depends on user — scheduleNext accessed via stable ref

  // Keep captureAndUpload ref in sync
  useEffect(() => {
    captureAndUploadRef.current = captureAndUpload
  }, [captureAndUpload])

  const stop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
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

  const start = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' } as MediaTrackConstraints,
      })

      const track = stream.getVideoTracks()[0]
      const surface = (track.getSettings() as { displaySurface?: string }).displaySurface
      if (surface !== 'monitor') {
        stream.getTracks().forEach(t => t.stop())
        setState({ isCapturing: false, error: 'Please select your entire screen, not a window or tab.' })
        return false
      }

      streamRef.current = stream

      if (!videoRef.current) {
        videoRef.current = document.createElement('video')
        videoRef.current.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px'
        document.body.appendChild(videoRef.current)
      }
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas')
        canvasRef.current.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px'
        document.body.appendChild(canvasRef.current)
      }

      videoRef.current.srcObject = stream
      try {
        await videoRef.current.play()
      } catch {
        // jsdom and some environments don't support play() — continue regardless
      }

      track.onended = () => {
        stop()
        onForcedClockOut()
      }

      setState({ isCapturing: true, error: null })
      scheduleNext()
      return true
    } catch {
      setState({ isCapturing: false, error: 'Screen sharing was cancelled.' })
      return false
    }
  }, [scheduleNext, stop, onForcedClockOut])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
      if (videoRef.current) {
        videoRef.current.remove()
        videoRef.current = null
      }
      if (canvasRef.current) {
        canvasRef.current.remove()
        canvasRef.current = null
      }
    }
  }, [])

  return { ...state, start, stop }
}
