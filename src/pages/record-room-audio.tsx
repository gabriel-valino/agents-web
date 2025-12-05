/** biome-ignore-all lint/suspicious/noConsole: <explanation> */

import { useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'

const isRecordingSupported =
  !!navigator.mediaDevices &&
  typeof navigator.mediaDevices.getUserMedia === 'function' &&
  typeof window.MediaRecorder !== 'undefined'

type RoomParams = {
  roomId: string
}

export function RecordRoomAudio() {
  const params = useParams<RoomParams>()
  const [isRecording, setIsRecording] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const uploadQueue = useRef<Blob[]>([])
  const processingQueue = useRef(false)
  const collectedChunks = useRef<Blob[]>([])

  if (!params.roomId) {
    return <Navigate replace to="/" />
  }

  function stopRecording() {
    setIsRecording(false)

    if (recorder.current && recorder.current.state !== 'inactive') {
      recorder.current.stop()
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }
  }

  async function uploadAudio(audio: Blob) {
    const formData = new FormData()
    const filename = `audio-${Date.now()}.webm`

    formData.append('file', audio, filename)

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/rooms/${params.roomId}/audio`,
      {
        method: 'POST',
        body: formData,
      }
    )

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Upload failed: ${response.status} ${text}`)
    }

    return response.json()
  }

  function createRecorder(stream: MediaStream) {
    const preferred = 'audio/webm'
    let mimeType: string | undefined

    const mr = MediaRecorder as unknown as {
      isTypeSupported?: (t: string) => boolean
    }
    if (typeof mr.isTypeSupported === 'function') {
      const supported = mr.isTypeSupported(preferred)
      if (supported) {
        mimeType = preferred
      }
    }

    recorder.current = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: 64_000,
    })

    recorder.current.ondataavailable = (event) => {
      if (event.data.size > 0) {
        // enqueue and let the queue processor handle uploads
        uploadQueue.current.push(event.data)
        // also collect for final merged upload
        collectedChunks.current.push(event.data)
        processQueue().catch((err) => console.error('Queue process error', err))
      }
    }

    recorder.current.onstart = () => {
      console.log('Gravação iniciada!')
    }

    recorder.current.onstop = () => {
      console.log('Gravação encerrada/pausada')

      async function handleFullUpload() {
        try {
          if (collectedChunks.current.length === 0) {
            return
          }

          const full = new Blob(collectedChunks.current, { type: 'audio/webm' })
          await uploadFullAudio(full)
        } catch (err) {
          console.error('Failed to upload full audio', err)
        } finally {
          collectedChunks.current = []
        }
      }

      handleFullUpload()
    }
    // Start continuous recording. We'll call requestData() on an interval to
    // emit chunks via ondataavailable without stopping the recorder.
    recorder.current.start()
  }

  function processQueue(): Promise<void> {
    if (processingQueue.current) {
      return Promise.resolve()
    }

    processingQueue.current = true

    // take a snapshot of current queue and clear it so new items can be enqueued
    const items = uploadQueue.current.splice(0)

    let chain = Promise.resolve()

    for (const blob of items) {
      chain = chain
        .then(() => uploadAudio(blob))
        .catch((err) => {
          console.error('Upload failed, retrying', err)
          uploadQueue.current.unshift(blob)
          return new Promise((res) => setTimeout(res, 1000))
        })
    }

    return chain.finally(() => {
      processingQueue.current = false
    })
  }

  async function uploadFullAudio(audio: Blob) {
    const form = new FormData()
    const filename = `audio-full-${Date.now()}.webm`
    form.append('file', audio, filename)

    const resp = await fetch(
      `${import.meta.env.VITE_API_URL}/rooms/${params.roomId}/audio/full`,
      {
        method: 'POST',
        body: form,
      }
    )

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`Full upload failed: ${resp.status} ${text}`)
    }

    return resp.json()
  }

  async function startRecording() {
    if (!isRecordingSupported) {
      alert('O seu navegador não suporta gravação')
      return
    }

    setIsRecording(true)

    const audio = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 44_100,
      },
    })

    createRecorder(audio)

    // requestData will trigger ondataavailable, so call it every 5s
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }

    intervalRef.current = setInterval(() => {
      try {
        recorder.current?.requestData()
      } catch (err) {
        console.error('Failed to request data from recorder', err)
      }
    }, 5000)
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3">
      {isRecording ? (
        <Button onClick={stopRecording}>Pausar gravação</Button>
      ) : (
        <Button onClick={startRecording}>Gravar áudio</Button>
      )}
      {isRecording ? <p>Gravando...</p> : <p>Pausado</p>}
    </div>
  )
}
