import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CreditCard, Music, ListMusic, Mic, Trash2, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'

type Card = {
  id: number
  uid: string
  name: string | null
  mediaId: number | null
  playlistId: number | null
  podcastFeedId: number | null
  volume: number | null
  createdAt: string
}

const cardsQueryOptions = queryOptions({
  queryKey: ['cards'],
  queryFn: async () => {
    const { data, error } = await api.GET('/api/cards')
    if (error) throw new Error('Failed to load cards')
    return data
  },
})

export const Route = createFileRoute('/_library/cards')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(cardsQueryOptions)
  },
  component: CardsPage,
})

function CardsPage() {
  const [deletingCard, setDeletingCard] = useState<Card | null>(null)

  const { data: cards } = useSuspenseQuery(cardsQueryOptions)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Cards</h1>
      </div>

      {cards.length === 0 ? (
        <EmptyState />
      ) : (
        <CardsTable cards={cards as Card[]} onDelete={setDeletingCard} />
      )}

      {deletingCard && (
        <DeleteCardDialog
          card={deletingCard}
          onClose={() => setDeletingCard(null)}
        />
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="text-center py-12">
      <CreditCard className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
      <h2 className="text-lg font-semibold mb-2">No cards registered</h2>
      <p className="text-muted-foreground">
        Scan an NFC card on your device to register it.
      </p>
    </div>
  )
}

function CardsTable({
  cards,
  onDelete,
}: {
  cards: Card[]
  onDelete: (card: Card) => void
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-muted/50">
          <tr className="text-left text-sm text-muted-foreground">
            <th className="px-4 py-3 font-medium">Card</th>
            <th className="px-4 py-3 font-medium">UID</th>
            <th className="px-4 py-3 font-medium">Linked Content</th>
            <th className="px-4 py-3 font-medium">Volume</th>
            <th className="px-4 py-3 font-medium w-16"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {cards.map((card) => (
            <CardRow
              key={card.id}
              card={card}
              onDelete={() => onDelete(card)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CardRow({
  card,
  onDelete,
}: {
  card: Card
  onDelete: () => void
}) {
  const contentType = getContentType(card)
  const ContentIcon = getContentIcon(contentType)

  return (
    <tr className="hover:bg-muted/30 transition-colors group">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-muted rounded flex items-center justify-center">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
          </div>
          <span className="font-medium">{card.name || 'Unnamed Card'}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <code className="text-sm text-muted-foreground bg-muted px-2 py-1 rounded">
          {card.uid}
        </code>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <ContentIcon className="h-4 w-4" />
          <span className="text-sm">{getContentLabel(card)}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {card.volume !== null ? `${card.volume}` : '—'}
      </td>
      <td className="px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </td>
    </tr>
  )
}

function DeleteCardDialog({
  card,
  onClose,
}: {
  card: Card
  onClose: () => void
}) {
  const queryClient = useQueryClient()

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE('/api/cards/{id}', {
        params: { path: { id: String(card.id) } },
      })
      if (error) throw new Error('Failed to delete')
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['cards'] })
      const previous = queryClient.getQueryData<Card[]>(['cards'])

      queryClient.setQueryData<Card[]>(['cards'], (old) =>
        old?.filter((c) => c.id !== card.id)
      )

      onClose()
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['cards'], context.previous)
      }
      toast.error('Failed to delete card')
    },
    onSuccess: () => {
      toast.success('Card deleted')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['cards'] })
    },
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Delete Card</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-muted-foreground mb-6">
          Are you sure you want to delete "{card.name || card.uid}"? The linked content will not be deleted.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}

function getContentType(card: Card): 'media' | 'playlist' | 'podcast' | 'unmapped' {
  if (card.mediaId) return 'media'
  if (card.playlistId) return 'playlist'
  if (card.podcastFeedId) return 'podcast'
  return 'unmapped'
}

function getContentIcon(type: 'media' | 'playlist' | 'podcast' | 'unmapped') {
  switch (type) {
    case 'media':
      return Music
    case 'playlist':
      return ListMusic
    case 'podcast':
      return Mic
    default:
      return CreditCard
  }
}

function getContentLabel(card: Card): string {
  if (card.mediaId) return `Song #${card.mediaId}`
  if (card.playlistId) return `Playlist #${card.playlistId}`
  if (card.podcastFeedId) return `Podcast #${card.podcastFeedId}`
  return 'Not linked'
}
