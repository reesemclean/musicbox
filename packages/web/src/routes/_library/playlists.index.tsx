import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ListMusic, Plus, Trash2, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { getPlaylists, createPlaylist, deletePlaylist } from '@/server/playlists'

type Playlist = Awaited<ReturnType<typeof getPlaylists>>[number]

export const playlistsQueryOptions = queryOptions({
  queryKey: ['playlists'],
  queryFn: () => getPlaylists(),
})

export const Route = createFileRoute('/_library/playlists/')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(playlistsQueryOptions)
  },
  component: PlaylistsPage,
})

function PlaylistsPage() {
  const [showCreate, setShowCreate] = useState(false)
  const [deletingPlaylist, setDeletingPlaylist] = useState<Playlist | null>(null)

  const { data: playlists } = useSuspenseQuery(playlistsQueryOptions)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Playlists</h1>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Playlist
        </Button>
      </div>

      {playlists.length === 0 && (
        <EmptyState onCreate={() => setShowCreate(true)} />
      )}

      {playlists.length > 0 && (
        <PlaylistsTable playlists={playlists} onDelete={setDeletingPlaylist} />
      )}

      {showCreate && (
        <CreatePlaylistDialog onClose={() => setShowCreate(false)} />
      )}

      {deletingPlaylist && (
        <DeletePlaylistDialog
          playlist={deletingPlaylist}
          onClose={() => setDeletingPlaylist(null)}
        />
      )}
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="text-center py-12">
      <ListMusic className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
      <h2 className="text-lg font-semibold mb-2">No playlists yet</h2>
      <p className="text-muted-foreground mb-4">
        Create a playlist to organize your songs.
      </p>
      <Button onClick={onCreate}>
        <Plus className="h-4 w-4 mr-2" />
        Create Playlist
      </Button>
    </div>
  )
}

function PlaylistsTable({
  playlists,
  onDelete,
}: {
  playlists: Playlist[]
  onDelete: (playlist: Playlist) => void
}) {
  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr className="text-left text-sm text-muted-foreground">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {playlists.map((playlist) => (
              <PlaylistRow
                key={playlist.id}
                playlist={playlist}
                onDelete={() => onDelete(playlist)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile list */}
      <div className="md:hidden space-y-2">
        {playlists.map((playlist) => (
          <div key={playlist.id} className="bg-card rounded-lg border border-border p-3 flex items-center gap-3">
            <Link to="/playlists/$playlistId" params={{ playlistId: String(playlist.id) }} className="flex items-center gap-3 flex-1 min-w-0">
              <div className="h-10 w-10 bg-muted rounded flex items-center justify-center shrink-0">
                <ListMusic className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{playlist.name}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(playlist.createdAt).toLocaleDateString()}
                </div>
              </div>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 h-8 w-8 p-0"
              onClick={() => onDelete(playlist)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    </>
  )
}

function PlaylistRow({
  playlist,
  onDelete,
}: {
  playlist: Playlist
  onDelete: () => void
}) {
  return (
    <tr className="hover:bg-muted/30 transition-colors group">
      <td className="px-4 py-3">
        <Link to="/playlists/$playlistId" params={{ playlistId: String(playlist.id) }} className="flex items-center gap-3">
          <div className="h-10 w-10 bg-muted rounded flex items-center justify-center">
            <ListMusic className="h-5 w-5 text-muted-foreground" />
          </div>
          <span className="font-medium">{playlist.name}</span>
        </Link>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {new Date(playlist.createdAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </td>
    </tr>
  )
}

function CreatePlaylistDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: async () => {
      return createPlaylist({ data: { name } })
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['playlists'] })

      const previous = queryClient.getQueryData<Playlist[]>(['playlists'])

      // Optimistically add with temp id
      const tempPlaylist: Playlist = {
        id: -Date.now(),
        name,
        createdAt: new Date(),
      }
      queryClient.setQueryData<Playlist[]>(['playlists'], (old) =>
        old ? [...old, tempPlaylist] : [tempPlaylist]
      )

      onClose()
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['playlists'], context.previous)
      }
      toast.error('Failed to create playlist')
    },
    onSuccess: () => {
      toast.success('Playlist created')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] })
    },
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">New Playlist</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div>
          <label className="text-sm font-medium mb-1 block">Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Playlist"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) {
                createMutation.mutate()
              }
            }}
          />
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !name.trim()}
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Create
          </Button>
        </div>
      </div>
    </div>
  )
}

function DeletePlaylistDialog({
  playlist,
  onClose,
}: {
  playlist: Playlist
  onClose: () => void
}) {
  const queryClient = useQueryClient()

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await deletePlaylist({ data: { id: playlist.id } })
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['playlists'] })

      const previous = queryClient.getQueryData<Playlist[]>(['playlists'])

      queryClient.setQueryData<Playlist[]>(['playlists'], (old) =>
        old?.filter((p) => p.id !== playlist.id)
      )

      onClose()
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['playlists'], context.previous)
      }
      toast.error('Failed to delete playlist')
    },
    onSuccess: () => {
      toast.success('Playlist deleted')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] })
    },
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold mb-2">Delete Playlist</h2>
        <p className="text-muted-foreground mb-6">
          Are you sure you want to delete "{playlist.name}"? The songs will not be deleted.
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
