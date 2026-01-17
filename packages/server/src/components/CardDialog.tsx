import { useEffect, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { CardMapping } from 'shared'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { getPlaylists, getSongs } from '@/services/songsServerFunctions'
import { useNFCScanning } from '@/components/CardDialog/useNFCScanning'
import { useCardMutations } from '@/components/CardDialog/useCardMutations'
import { NFCScanWaiting } from '@/components/CardDialog/NFCScanWaiting'
import { CardForm } from '@/components/CardDialog/CardForm'

interface CardDialogProps {
  mode: 'create' | 'edit'
  card?: CardMapping
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

type DialogState = 'waiting-scan' | 'form'

export function CardDialog({
  mode,
  card,
  open,
  onOpenChange,
  onSuccess,
}: CardDialogProps) {
  const [state, setState] = useState<DialogState>(
    mode === 'create' ? 'waiting-scan' : 'form',
  )
  const [nfcId, setNfcId] = useState<string>(card?.nfcId || '')
  const [contentType, setContentType] = useState<
    'song' | 'playlist' | 'action'
  >(card?.contentType || 'song')
  const [contentValue, setContentValue] = useState<string | null>(
    card?.contentPath || card?.action || null,
  )
  const [isEditingExisting, setIsEditingExisting] = useState(false)

  // Fetch songs and playlists
  const { data: songs = [] } = useSuspenseQuery({
    queryKey: ['songs'],
    queryFn: getSongs,
  })

  const { data: playlists = [] } = useSuspenseQuery({
    queryKey: ['playlists'],
    queryFn: getPlaylists,
  })

  // Handle NFC scan detection
  const handleScanDetected = (scannedNfcId: string, existingCard: any) => {
    setNfcId(scannedNfcId)

    if (existingCard) {
      setIsEditingExisting(true)
      setContentType(existingCard.contentType)
      setContentValue(existingCard.contentPath || existingCard.action || null)
    } else {
      setIsEditingExisting(false)
    }

    setState('form')
  }

  // Handle dialog close - reset state
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      // Capture current mode/card before calling onOpenChange (which may clear them)
      const currentMode = mode
      const currentCard = card

      onOpenChange(isOpen)

      // Reset state when closing - use setTimeout to avoid visual glitches
      setTimeout(() => {
        setState(currentMode === 'create' ? 'waiting-scan' : 'form')
        setNfcId(currentCard?.nfcId || '')
        setContentType(currentCard?.contentType || 'song')
        setContentValue(currentCard?.contentPath || currentCard?.action || null)
        setIsEditingExisting(false)
      }, 200)
    } else {
      onOpenChange(isOpen)
    }
  } // NFC scanning hook
  useNFCScanning({
    enabled: state === 'waiting-scan' && open,
    onScanDetected: handleScanDetected,
  })

  // Card mutations
  const { createMutation, updateMutation } = useCardMutations({ onSuccess })

  // Sync state when mode/card changes (e.g., switching from edit to create)
  useEffect(() => {
    if (open) {
      setState(mode === 'create' ? 'waiting-scan' : 'form')
      setNfcId(card?.nfcId || '')
      setContentType(card?.contentType || 'song')
      setContentValue(card?.contentPath || card?.action || null)
      setIsEditingExisting(false)
    }
  }, [mode, card, open])

  // Reset content value when content type changes
  useEffect(() => {
    setContentValue(null)
  }, [contentType])

  const handleSave = () => {
    if (!nfcId.trim()) {
      toast.error('NFC ID is required')
      return
    }

    if (!contentValue) {
      toast.error(`Please select a ${contentType}`)
      return
    }

    const data: any = {
      nfcId: nfcId.trim(),
      contentType,
    }

    if (contentType === 'action') {
      data.action = contentValue
      data.contentPath = undefined
    } else {
      data.contentPath = contentValue
      data.action = undefined
    }

    if (mode === 'create' && !isEditingExisting) {
      createMutation.mutate(data)
    } else {
      updateMutation.mutate(data)
    }
  }

  const isLoading = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-125">
        {state === 'waiting-scan' ? (
          <NFCScanWaiting onCancel={() => handleOpenChange(false)} />
        ) : (
          <CardForm
            mode={mode === 'create' && !isEditingExisting ? 'create' : 'update'}
            isEditingExisting={isEditingExisting}
            nfcId={nfcId}
            contentType={contentType}
            contentValue={contentValue}
            songs={songs}
            playlists={playlists}
            isLoading={isLoading}
            onContentTypeChange={setContentType}
            onContentValueChange={setContentValue}
            onCancel={() => handleOpenChange(false)}
            onSave={handleSave}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
