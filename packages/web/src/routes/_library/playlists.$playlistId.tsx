import { useState } from 'react'
import { createFileRoute, useNavigate, notFound } from '@tanstack/react-router'
import {
  queryOptions,
  useSuspenseQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { DragEndEvent } from '@dnd-kit/core'
import { GripVertical, ListMusic, Music, Plus, Trash2, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, type Media } from '@/lib/api-client'
import { Button } from '@/components/ui/button'

type PlaylistMedia = Media & { position: number }

const playlistQueryOptions = (playlistId: number) =>
  queryOptions({
    queryKey: ['playlist', playlistId],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/playlists/{id}', {
        params: { path: { id: String(playlistId) } },
      })
      if (error) throw notFound()
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

export const Route = createFileRoute('/_library/playlists/$playlistId')({
  loader: async ({ context, params }) => {
    const playlistId = parseInt(params.playlistId)
    await Promise.all([
      context.queryClient.ensureQueryData(playlistQueryOptions(playlistId)),
      context.queryClient.ensureQueryData(songsQueryOptions),
    ])
  },
  component: PlaylistDetailPage,
})

function PlaylistDetailPage() {
  const { playlistId } = Route.useParams()
  const id = parseInt(playlistId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showAddSongs, setShowAddSongs] = useState(false)

  const { data: playlist } = useSuspenseQuery(playlistQueryOptions(id))
  const { data: allSongs } = useSuspenseQuery(songsQueryOptions)

  const playlistItems = playlist.items as PlaylistMedia[]
  const itemIds = playlistItems.map((item) => item.id)

  // Songs not in the playlist
  const availableSongs = allSongs.filter(
    (song) => !playlistItems.some((item) => item.id === song.id)
  )

  // Reorder mutation
  const reorderMutation = useMutation({
    mutationFn: async (mediaIds: number[]) => {
      const { error } = await api.PUT('/api/playlists/{id}/reorder', {
        params: { path: { id: String(id) } },
        body: { mediaIds },
      })
      if (error) throw new Error('Failed to reorder')
    },
    onMutate: async (mediaIds) => {
      await queryClient.cancelQueries({ queryKey: ['playlist', id] })
      const previous = queryClient.getQueryData(['playlist', id])

      queryClient.setQueryData(['playlist', id], (old: any) => {
        if (!old) return old
        const reorderedItems = mediaIds.map((mediaId, index) => {
          const item = old.items.find((i: PlaylistMedia) => i.id === mediaId)
          return { ...item, position: index }
        })
        return { ...old, items: reorderedItems }
      })

      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['playlist', id], context.previous)
      }
      toast.error('Failed to reorder playlist')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['playlist', id] })
    },
  })

  // Remove song mutation
  const removeMutation = useMutation({
    mutationFn: async (mediaId: number) => {
      const { error } = await api.DELETE('/api/playlists/{id}/media/{mediaId}', {
        params: { path: { id: String(id), mediaId: String(mediaId) } },
      })
      if (error) throw new Error('Failed to remove song')
    },
    onMutate: async (mediaId) => {
      await queryClient.cancelQueries({ queryKey: ['playlist', id] })
      const previous = queryClient.getQueryData(['playlist', id])

      queryClient.setQueryData(['playlist', id], (old: any) => {
        if (!old) return old
        return {
          ...old,
          items: old.items.filter((item: PlaylistMedia) => item.id !== mediaId),
        }
      })

      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['playlist', id], context.previous)
      }
      toast.error('Failed to remove song')
    },
    onSuccess: () => {
      toast.success('Song removed from playlist')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['playlist', id] })
    },
  })

  // Add song mutation
  const addMutation = useMutation({
    mutationFn: async (mediaId: number) => {
      const { error } = await api.POST('/api/playlists/{id}/media', {
        params: { path: { id: String(id) } },
        body: { mediaId },
      })
      if (error) throw new Error('Failed to add song')
    },
    onMutate: async (mediaId) => {
      await queryClient.cancelQueries({ queryKey: ['playlist', id] })
      const previous = queryClient.getQueryData(['playlist', id])

      // Find the song from allSongs to add optimistically
      const songToAdd = allSongs.find((s) => s.id === mediaId)
      if (songToAdd) {
        queryClient.setQueryData(['playlist', id], (old: any) => {
          if (!old) return old
          const newPosition = old.items.length
          return {
            ...old,
            items: [...old.items, { ...songToAdd, position: newPosition }],
          }
        })
      }

      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['playlist', id], context.previous)
      }
      toast.error('Failed to add song')
    },
    onSuccess: () => {
      toast.success('Song added to playlist')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['playlist', id] })
    },
  })

  // Delete playlist mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE('/api/playlists/{id}', {
        params: { path: { id: String(id) } },
      })
      if (error) throw new Error('Failed to delete playlist')
    },
    onSuccess: () => {
      toast.success('Playlist deleted')
      queryClient.invalidateQueries({ queryKey: ['playlists'] })
      navigate({ to: '/playlists' })
    },
    onError: () => {
      toast.error('Failed to delete playlist')
    },
  })

  // Drag and drop
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = itemIds.indexOf(active.id as number)
      const newIndex = itemIds.indexOf(over.id as number)
      const newOrder = arrayMove(playlistItems, oldIndex, newIndex)
      reorderMutation.mutate(newOrder.map((item) => item.id))
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 bg-muted rounded-lg flex items-center justify-center">
            <ListMusic className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{playlist.name}</h1>
            <p className="text-muted-foreground">
              {playlistItems.length} {playlistItems.length === 1 ? 'song' : 'songs'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowAddSongs(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Songs
          </Button>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            Delete
          </Button>
        </div>
      </div>

      {playlistItems.length === 0 ? (
        <div className="text-center py-12">
          <Music className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold mb-2">No songs yet</h2>
          <p className="text-muted-foreground mb-4">
            Add songs to this playlist to get started.
          </p>
          <Button onClick={() => setShowAddSongs(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Songs
          </Button>
        </div>
      ) : (
        <DndContext
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
          sensors={sensors}
        >
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <div className="border border-border rounded-lg">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr className="text-left text-sm text-muted-foreground">
                    <th className="px-4 py-3 font-medium w-12"></th>
                    <th className="px-4 py-3 font-medium">Title</th>
                    <th className="px-4 py-3 font-medium">Artist</th>
                    <th className="px-4 py-3 font-medium text-right">Duration</th>
                    <th className="px-4 py-3 font-medium w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {playlistItems.map((item) => (
                    <SortableRow
                      key={item.id}
                      item={item}
                      onRemove={() => removeMutation.mutate(item.id)}
                      isRemoving={removeMutation.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </SortableContext>
        </DndContext>
      )}

      {showAddSongs && (
        <AddSongsDialog
          songs={availableSongs}
          onAdd={(mediaId) => addMutation.mutate(mediaId)}
          onClose={() => setShowAddSongs(false)}
          isAdding={addMutation.isPending}
        />
      )}
    </div>
  )
}

function SortableRow({
  item,
  onRemove,
  isRemoving,
}: {
  item: PlaylistMedia
  onRemove: () => void
  isRemoving: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  // Only apply transition when there's an active transform (item is moving)
  // This prevents the "settling" animation flash on drop
  const hasTransform = transform && (transform.x !== 0 || transform.y !== 0)

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: hasTransform ? transition : undefined,
    opacity: isDragging ? 0.5 : 1,
    boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.15)' : undefined,
  }

  const metadata = item.metadata as { artist?: string } | null

  return (
    <tr ref={setNodeRef} style={style} className="hover:bg-muted/30 transition-colors group">
      <td className="px-4 py-3">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 hover:bg-accent rounded"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-muted rounded flex items-center justify-center">
            <Music className="h-5 w-5 text-muted-foreground" />
          </div>
          <span className="font-medium">{item.title}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {metadata?.artist || '—'}
      </td>
      <td className="px-4 py-3 text-right text-muted-foreground">
        {formatDuration(item.duration)}
      </td>
      <td className="px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={isRemoving}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="h-4 w-4 text-destructive" />
        </Button>
      </td>
    </tr>
  )
}

function AddSongsDialog({
  songs,
  onAdd,
  onClose,
  isAdding,
}: {
  songs: Media[]
  onAdd: (mediaId: number) => void
  onClose: () => void
  isAdding: boolean
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-lg p-6 w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Add Songs</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {songs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            All songs are already in this playlist.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto border border-border rounded-lg">
            <table className="w-full">
              <tbody className="divide-y divide-border">
                {songs.map((song) => {
                  const metadata = song.metadata as { artist?: string } | null
                  return (
                    <tr key={song.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 bg-muted rounded flex items-center justify-center">
                            <Music className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <div className="font-medium">{song.title}</div>
                            <div className="text-sm text-muted-foreground">
                              {metadata?.artist || 'Unknown artist'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          onClick={() => onAdd(song.id)}
                          disabled={isAdding}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Add
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end mt-4">
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
