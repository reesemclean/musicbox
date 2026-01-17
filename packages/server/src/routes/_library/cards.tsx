import { createFileRoute } from '@tanstack/react-router'
import { Suspense, useState } from 'react'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { CreditCard, Plus } from 'lucide-react'
import type { Card } from '@/db/schema'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { CardDialog } from '@/components/CardDialog'
import { CardsTable } from '@/components/cards/CardsTable'
import { useCardDelete } from '@/components/cards/useCardDelete'
import { getContentDisplay } from '@/components/cards/getContentDisplay'
import { getAllCards } from '@/services/serverFunctions'
import { getPlaylists, getSongs } from '@/services/songsServerFunctions'

const cardsQueryOptions = queryOptions({
  queryKey: ['cards'],
  queryFn: getAllCards,
})

const songsQueryOptions = queryOptions({
  queryKey: ['songs'],
  queryFn: getSongs,
})

const playlistsQueryOptions = queryOptions({
  queryKey: ['playlists'],
  queryFn: getPlaylists,
})

export const Route = createFileRoute('/_library/cards')({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(cardsQueryOptions),
      context.queryClient.ensureQueryData(songsQueryOptions),
      context.queryClient.ensureQueryData(playlistsQueryOptions),
    ])
  },
  component: CardsPage,
})

function CardsPage() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editingCard, setEditingCard] = useState<Card | null>(null)
  const [cardToDelete, setCardToDelete] = useState<Card | null>(null)

  const { data: cards } = useSuspenseQuery(cardsQueryOptions)
  const { data: songs } = useSuspenseQuery(songsQueryOptions)
  const { data: playlists } = useSuspenseQuery(playlistsQueryOptions)

  const deleteMutation = useCardDelete(() => setCardToDelete(null))

  const handleEdit = (card: Card) => {
    setEditingCard(card)
  }

  const handleDelete = (card: Card) => {
    setCardToDelete(card)
  }

  return (
    <div className="p-6 pb-32">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">NFC Cards</h1>
          <p className="text-muted-foreground mt-1">
            Manage NFC card mappings for music playback
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Register New Card
        </Button>
      </div>

      {cards.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-lg border">
          <CreditCard className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">No NFC Cards</h3>
          <p className="text-muted-foreground mb-4">
            Register your first NFC card to get started
          </p>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Register New Card
          </Button>
        </div>
      ) : (
        <div className="bg-card rounded-lg border overflow-hidden">
          <CardsTable
            cards={cards}
            getContentDisplay={(card) =>
              getContentDisplay({ card, songs, playlists })
            }
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        </div>
      )}

      {/* Card Dialog for Create/Edit */}
      <Suspense fallback={null}>
        <CardDialog
          mode={editingCard ? 'edit' : 'create'}
          card={editingCard || undefined}
          open={createDialogOpen || !!editingCard}
          onOpenChange={(open) => {
            if (!open) {
              setCreateDialogOpen(false)
              setEditingCard(null)
            }
          }}
          onSuccess={() => {
            setCreateDialogOpen(false)
            setEditingCard(null)
          }}
        />
      </Suspense>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!cardToDelete}
        onOpenChange={(open) => !open && setCardToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete NFC Card</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this card mapping? This action
              cannot be undone.
              {cardToDelete && (
                <div className="mt-2 p-2 bg-muted rounded text-sm font-mono">
                  Card ID: {cardToDelete.nfcId}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (cardToDelete) {
                  deleteMutation.mutate(cardToDelete.nfcId)
                }
              }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
