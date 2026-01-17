import { useEffect, useRef, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import {
  getCard,
  pollNFCScans,
  startNFCScanSession,
  stopNFCScanSession,
} from '@/services/serverFunctions'

interface UseNFCScanningProps {
  enabled: boolean
  onScanDetected: (nfcId: string, existingCard: any) => void
}

export function useNFCScanning({
  enabled,
  onScanDetected,
}: UseNFCScanningProps) {
  const sessionIdRef = useRef<string | null>(null)
  const [isSessionReady, setIsSessionReady] = useState(false)

  const pollNFCScansFn = useServerFn(pollNFCScans)
  const getCardFn = useServerFn(getCard)
  const startNFCScanSessionFn = useServerFn(startNFCScanSession)
  const stopNFCScanSessionFn = useServerFn(stopNFCScanSession)

  // Start/stop NFC scan session
  useEffect(() => {
    if (enabled) {
      console.log('🎯 Starting NFC scan session')

      startNFCScanSessionFn({ data: undefined }).then((result) => {
        sessionIdRef.current = result.sessionId
        setIsSessionReady(true)
        console.log('🎯 Session ID:', result.sessionId)
      })

      return () => {
        setIsSessionReady(false)
        if (sessionIdRef.current) {
          console.log('🎯 Stopping NFC scan session:', sessionIdRef.current)
          stopNFCScanSessionFn({ data: { sessionId: sessionIdRef.current } })
          sessionIdRef.current = null
        }
      }
    }
  }, [enabled, startNFCScanSessionFn, stopNFCScanSessionFn])

  // Poll for NFC scans
  useEffect(() => {
    if (!isSessionReady || !enabled) return

    console.log('🎯 Starting NFC scan polling')

    const pollForScans = async () => {
      if (!sessionIdRef.current) return

      try {
        const result = await pollNFCScansFn({
          data: {
            sessionId: sessionIdRef.current,
          },
        })

        if (result.scans.length > 0) {
          const latestScan = result.scans[result.scans.length - 1]
          const scannedNfcId = latestScan.nfcId

          // Check if this card already exists
          try {
            const existingCard = await getCardFn({
              data: { nfcId: scannedNfcId },
            })
            onScanDetected(scannedNfcId, existingCard)
          } catch (error) {
            onScanDetected(scannedNfcId, null)
          }
        }
      } catch (error) {
        console.error('Failed to poll for NFC scans:', error)
      }
    }

    const interval = setInterval(pollForScans, 500)

    return () => {
      console.log('🎯 Stopped NFC scan polling')
      clearInterval(interval)
    }
  }, [isSessionReady, enabled, getCardFn, pollNFCScansFn, onScanDetected])

  return { isSessionReady }
}
