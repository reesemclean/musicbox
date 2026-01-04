import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { deleteCard } from '@/services/serverFunctions'

export function useCardDelete(onSuccess?: () => void) {
  const queryClient = useQueryClient()
  const deleteCardFn = useServerFn(deleteCard)

  return useMutation({
    mutationFn: async (nfcId: string) => {
      await deleteCardFn({ data: { nfcId } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards'] })
      toast.success('Card deleted successfully')
      onSuccess?.()
    },
    onError: (error: any) => {
      console.error('Failed to delete card:', error)
      toast.error('Failed to delete card', {
        description: error.message || 'An error occurred',
      })
    },
  })
}
