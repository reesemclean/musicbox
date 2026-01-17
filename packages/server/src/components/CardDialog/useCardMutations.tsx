import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { createCard, updateCard } from '@/services/serverFunctions'

interface UseCardMutationsProps {
  onSuccess: () => void
}

export function useCardMutations({ onSuccess }: UseCardMutationsProps) {
  const queryClient = useQueryClient()
  const createCardFn = useServerFn(createCard)
  const updateCardFn = useServerFn(updateCard)

  const createMutation = useMutation({
    mutationFn: async (data: {
      nfcId: string
      contentType: 'song' | 'playlist' | 'action'
      contentPath?: string
      action?: 'play' | 'pause' | 'next' | 'previous' | 'stop'
    }) => {
      return await createCardFn({ data })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards'] })
      toast.success('Card registered successfully')
      onSuccess()
    },
    onError: (error: any) => {
      console.error('Failed to create card:', error)
      const message = error.message || 'Failed to register card'
      if (message.includes('unique') || message.includes('UNIQUE')) {
        toast.error('Card already registered', {
          description: 'This NFC card ID is already in use',
        })
      } else {
        toast.error('Failed to register card', {
          description: message,
        })
      }
    },
  })

  const updateMutation = useMutation({
    mutationFn: async (data: {
      nfcId: string
      contentType?: 'song' | 'playlist' | 'action'
      contentPath?: string
      action?: 'play' | 'pause' | 'next' | 'previous' | 'stop'
    }) => {
      return await updateCardFn({ data })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards'] })
      toast.success('Card updated successfully')
      onSuccess()
    },
    onError: (error: any) => {
      console.error('Failed to update card:', error)
      toast.error('Failed to update card', {
        description: error.message || 'An error occurred',
      })
    },
  })

  return { createMutation, updateMutation }
}
