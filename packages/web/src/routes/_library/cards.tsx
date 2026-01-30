import { useState, useEffect, useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CreditCard, Music, ListMusic, Mic, Trash2, Loader2, X, Plus, Wifi } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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

type Media = {
  id: number
  type: 'song' | 'podcast' | 'soundmachine'
  title: string
  metadata: unknown
}

type Playlist = {
  id: number
  name: string
}

const cardsQueryOptions = queryOptions({
  queryKey: ['cards'],
  queryFn: async () => {
    const { data, error } = await api.GET('/api/cards')
    if (error) throw new Error('Failed to load cards')
    return data
  },
})

const songsQueryOptions = queryOptions({
  queryKey: ['media', 'songs'],
  queryFn: async () => {
    const { data, error } = await api.GET('/api/media', {
      params: { query: { type: 'song' } },
    })
    if (error) throw new Error('Failed to load songs')
    return data
  },
})

const playlistsQueryOptions = queryOptions({
  queryKey: ['playlists'],
  queryFn: async () => {
    const { data, error } = await api.GET('/api/playlists')
    if (error) throw new Error('Failed to load playlists')
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
  const [showRegister, setShowRegister] = useState(false)

  const { data: cards } = useSuspenseQuery(cardsQueryOptions)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Cards</h1>
        <Button onClick={() => setShowRegister(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Register Card
        </Button>
      </div>

      {cards.length === 0 ? (
        <EmptyState onRegister={() => setShowRegister(true)} />
      ) : (
        <CardsTable cards={cards as Card[]} onDelete={setDeletingCard} />
      )}

      {deletingCard && (
        <DeleteCardDialog
          card={deletingCard}
          onClose={() => setDeletingCard(null)}
        />
      )}

      {showRegister && (
        <RegisterCardDialog onClose={() => setShowRegister(false)} />
      )}
    </div>
  )
}

function EmptyState({ onRegister }: { onRegister: () => void }) {
  return (
    <div className="text-center py-12">
      <CreditCard className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
      <h2 className="text-lg font-semibold mb-2">No cards registered</h2>
      <p className="text-muted-foreground mb-4">
        Register an NFC card to link it with your music.
      </p>
      <Button onClick={onRegister}>
        <Plus className="h-4 w-4 mr-2" />
        Register Card
      </Button>
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

type RegistrationStep = 'waiting' | 'configure'

function RegisterCardDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<RegistrationStep>('waiting')
  const [scannedUid, setScannedUid] = useState<string | null>(null)
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const wsRef = useRef<WebSocket | null>(null)
  const queryClient = useQueryClient()

  // Fetch songs and playlists for the configure step (non-suspense to avoid flash)
  const { data: songs = [], isLoading: songsLoading } = useQuery(songsQueryOptions)
  const { data: playlists = [], isLoading: playlistsLoading } = useQuery(playlistsQueryOptions)
  const isLoading = songsLoading || playlistsLoading

  // Connect to WebSocket for card scan events with auto-reconnect
  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001'
    const wsUrl = apiUrl.replace(/^http/, 'ws') + '/ws/control'
    let reconnectTimeout: ReturnType<typeof setTimeout>
    let mounted = true
    let ws: WebSocket | null = null

    const connect = () => {
      if (!mounted) return

      ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        if (mounted) setWsStatus('connected')
      }

      ws.onmessage = (event) => {
        if (!mounted) return
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'card_scanned' && data.uid) {
            setScannedUid(data.uid)
            setStep('configure')
          }
        } catch {
          // Ignore non-JSON messages
        }
      }

      ws.onclose = () => {
        if (mounted) {
          setWsStatus('disconnected')
          reconnectTimeout = setTimeout(connect, 1000)
        }
      }

      ws.onerror = () => {
        ws?.close()
      }
    }

    connect()

    return () => {
      mounted = false
      clearTimeout(reconnectTimeout)
      if (ws) {
        ws.onclose = null // Prevent reconnect on intentional close
        ws.close()
      }
    }
  }, [])

  // Simulate card scan for testing
  const simulateScan = () => {
    const fakeUid = `SIM${Date.now().toString(16).toUpperCase()}`
    setScannedUid(fakeUid)
    setStep('configure')
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-lg p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Register Card</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {step === 'waiting' && (
          <WaitingForScan
            wsStatus={wsStatus}
            onSimulate={simulateScan}
            onClose={onClose}
          />
        )}

        {step === 'configure' && scannedUid && (
          <ConfigureCard
            uid={scannedUid}
            songs={songs as Media[]}
            playlists={playlists as Playlist[]}
            isLoading={isLoading}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['cards'] })
              onClose()
            }}
            onBack={() => {
              setStep('waiting')
              setScannedUid(null)
            }}
          />
        )}
      </div>
    </div>
  )
}

function WaitingForScan({
  wsStatus,
  onSimulate,
  onClose,
}: {
  wsStatus: 'connecting' | 'connected' | 'disconnected'
  onSimulate: () => void
  onClose: () => void
}) {
  const statusColor = wsStatus === 'connected' ? 'bg-green-500' : wsStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'

  return (
    <div className="text-center py-8">
      <div className="relative inline-block mb-6">
        <CreditCard className="h-16 w-16 text-muted-foreground animate-pulse" />
        <div className={`absolute -top-1 -right-1 h-4 w-4 rounded-full ${statusColor}`}>
          <Wifi className="h-3 w-3 text-white m-0.5" />
        </div>
      </div>
      <h3 className="text-lg font-medium mb-2">Waiting for card scan...</h3>
      <p className="text-muted-foreground mb-6">
        Tap an NFC card on your MusicBox device
      </p>
      <div className="flex justify-center gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="secondary" onClick={onSimulate}>
          Simulate Scan
        </Button>
      </div>
      {wsStatus === 'disconnected' && (
        <p className="text-sm text-red-600 mt-4">
          WebSocket disconnected. Make sure the API server is running.
        </p>
      )}
    </div>
  )
}

function ConfigureCard({
  uid,
  songs,
  playlists,
  isLoading,
  onSuccess,
  onBack,
}: {
  uid: string
  songs: Media[]
  playlists: Playlist[]
  isLoading: boolean
  onSuccess: () => void
  onBack: () => void
}) {
  const [name, setName] = useState('')
  const [contentType, setContentType] = useState<'song' | 'playlist'>('song')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const createMutation = useMutation({
    mutationFn: async () => {
      const body = contentType === 'song'
        ? { uid, name: name || undefined, type: 'media' as const, mediaId: selectedId! }
        : { uid, name: name || undefined, type: 'playlist' as const, playlistId: selectedId! }

      const { error } = await api.POST('/api/cards', { body })
      if (error) throw new Error('Failed to create card')
    },
    onSuccess: () => {
      toast.success('Card registered successfully')
      onSuccess()
    },
    onError: () => {
      toast.error('Failed to register card')
    },
  })

  const items = contentType === 'song' ? songs : playlists

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
          <CreditCard className="h-8 w-8 text-muted-foreground" />
          <div>
            <div className="font-medium">Card Detected</div>
            <code className="text-sm text-muted-foreground">{uid}</code>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-1 block">Card Name (optional)</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Kids Music Card"
          />
        </div>

        <div>
          <label className="text-sm font-medium mb-2 block">Link to</label>
          <div className="flex gap-2 mb-3">
            <Button
              variant={contentType === 'song' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setContentType('song'); setSelectedId(null) }}
            >
              <Music className="h-4 w-4 mr-1" />
              Song
            </Button>
            <Button
              variant={contentType === 'playlist' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setContentType('playlist'); setSelectedId(null) }}
            >
              <ListMusic className="h-4 w-4 mr-1" />
              Playlist
            </Button>
          </div>

          <div className="border border-border rounded-lg max-h-48 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : items.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                No {contentType === 'song' ? 'songs' : 'playlists'} available
              </div>
            ) : (
              <div className="divide-y divide-border">
                {items.map((item) => {
                  const itemId = item.id
                  const itemName = 'title' in item ? item.title : item.name
                  const isSelected = selectedId === itemId

                  return (
                    <button
                      key={itemId}
                      onClick={() => setSelectedId(itemId)}
                      className={`w-full px-4 py-2 text-left text-sm hover:bg-muted/50 flex items-center gap-2 ${isSelected ? 'bg-accent' : ''}`}
                    >
                      {contentType === 'song' ? (
                        <Music className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ListMusic className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className={isSelected ? 'font-medium' : ''}>{itemName}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-between mt-6">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          onClick={() => createMutation.mutate()}
          disabled={!selectedId || createMutation.isPending}
        >
          {createMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : null}
          Register Card
        </Button>
      </div>
    </div>
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
