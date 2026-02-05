import { createContext, useContext, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useMqtt, type MqttEvent, type CardScannedEvent } from './useMqtt'

interface MqttContextValue {
  isConnected: boolean
  lastCardScanned: CardScannedEvent | null
  clearLastCardScanned: () => void
}

const MqttContext = createContext<MqttContextValue | null>(null)

export function MqttProvider({ children }: { children: React.ReactNode }) {
  const [lastCardScanned, setLastCardScanned] = useState<CardScannedEvent | null>(null)

  const handleEvent = useCallback((event: MqttEvent) => {
    if (event.type === 'card_scanned' && !event.handledLocally) {
      // Store for components that need to react to unknown card scans
      setLastCardScanned(event)

      // Show toast for unknown cards (cards not in cache won't have handledLocally set)
      toast('Card scanned', {
        description: `Card ${event.uid} was scanned`,
        duration: 5000,
      })
    }
  }, [])

  const { isConnected } = useMqtt({ onEvent: handleEvent })

  const clearLastCardScanned = useCallback(() => {
    setLastCardScanned(null)
  }, [])

  return (
    <MqttContext.Provider value={{ isConnected, lastCardScanned, clearLastCardScanned }}>
      {children}
    </MqttContext.Provider>
  )
}

export function useMqttContext() {
  const context = useContext(MqttContext)
  if (!context) {
    throw new Error('useMqttContext must be used within an MqttProvider')
  }
  return context
}
