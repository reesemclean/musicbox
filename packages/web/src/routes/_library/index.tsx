import { useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Music, Search, Upload, Loader2, Pencil, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, type Media } from '@/lib/api-client'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/_library/')({
  component: SongsLibraryPage,
})

function SongsLibraryPage() {
  const [search, setSearch] = useState('')
  const [editingSong, setEditingSong] = useState<Media | null>(null)
  const [deletingSong, setDeletingSong] = useState<Media | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  const { data: songs, isLoading, error } = useQuery({
    queryKey: ['media', 'songs'],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/media', {
        params: { query: { type: 'song' } },
      })
      if (error) throw new Error('Failed to load songs')
      return data
    },
  })

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/media`,
        {
          method: 'POST',
          body: formData,
        }
      )

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Upload failed')
      }

      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', 'songs'] })
      toast.success('Song uploaded successfully')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    },
  })

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return

    for (const file of files) {
      if (!file.type.startsWith('audio/')) {
        toast.error(`Not an audio file: ${file.name}`)
        continue
      }
      uploadMutation.mutate(file)
    }

    // Reset input
    e.target.value = ''
  }

  const filteredSongs = songs?.filter((song) =>
    song.title.toLowerCase().includes(search.toLowerCase()) ||
    (song.metadata as any)?.artist?.toLowerCase().includes(search.toLowerCase()) ||
    (song.metadata as any)?.album?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">All Songs</h1>
        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search songs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
          >
            {uploadMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            Upload
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="text-center py-12 text-muted-foreground">
          Loading songs...
        </div>
      )}

      {error && (
        <div className="text-center py-12 text-destructive">
          Error: {error instanceof Error ? error.message : 'Failed to load'}
        </div>
      )}

      {songs && songs.length === 0 && !isLoading && (
        <EmptyState onUpload={() => fileInputRef.current?.click()} />
      )}

      {filteredSongs && filteredSongs.length > 0 && (
        <SongsTable
          songs={filteredSongs}
          onEdit={setEditingSong}
          onDelete={setDeletingSong}
        />
      )}

      {songs && songs.length > 0 && filteredSongs?.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No songs match your search.
        </div>
      )}

      {editingSong && (
        <EditSongDialog
          song={editingSong}
          onClose={() => setEditingSong(null)}
        />
      )}

      {deletingSong && (
        <DeleteSongDialog
          song={deletingSong}
          onClose={() => setDeletingSong(null)}
        />
      )}
    </div>
  )
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="text-center py-12">
      <Music className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
      <h2 className="text-lg font-semibold mb-2">No songs yet</h2>
      <p className="text-muted-foreground mb-4">
        Upload some music to get started.
      </p>
      <Button onClick={onUpload}>
        <Upload className="h-4 w-4 mr-2" />
        Upload Songs
      </Button>
    </div>
  )
}

function SongsTable({
  songs,
  onEdit,
  onDelete,
}: {
  songs: Media[]
  onEdit: (song: Media) => void
  onDelete: (song: Media) => void
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-muted/50">
          <tr className="text-left text-sm text-muted-foreground">
            <th className="px-4 py-3 font-medium">Title</th>
            <th className="px-4 py-3 font-medium">Artist</th>
            <th className="px-4 py-3 font-medium">Album</th>
            <th className="px-4 py-3 font-medium text-right">Duration</th>
            <th className="px-4 py-3 font-medium w-24"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {songs.map((song) => (
            <SongRow
              key={song.id}
              song={song}
              onEdit={() => onEdit(song)}
              onDelete={() => onDelete(song)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SongRow({
  song,
  onEdit,
  onDelete,
}: {
  song: Media
  onEdit: () => void
  onDelete: () => void
}) {
  const metadata = song.metadata as { artist?: string; album?: string } | null

  return (
    <tr className="hover:bg-muted/30 transition-colors group">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-muted rounded flex items-center justify-center">
            <Music className="h-5 w-5 text-muted-foreground" />
          </div>
          <span className="font-medium">{song.title}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {metadata?.artist || '—'}
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {metadata?.album || '—'}
      </td>
      <td className="px-4 py-3 text-right text-muted-foreground">
        {formatDuration(song.duration)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </td>
    </tr>
  )
}

function EditSongDialog({
  song,
  onClose,
}: {
  song: Media
  onClose: () => void
}) {
  const metadata = song.metadata as { artist?: string; album?: string } | null
  const [title, setTitle] = useState(song.title)
  const [artist, setArtist] = useState(metadata?.artist || '')
  const [album, setAlbum] = useState(metadata?.album || '')
  const queryClient = useQueryClient()

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH('/api/media/{id}', {
        params: { path: { id: String(song.id) } },
        body: {
          title,
          metadata: {
            artist: artist || null,
            album: album || null,
          },
        },
      })
      if (error) throw new Error('Failed to update')
    },
    onMutate: async () => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['media', 'songs'] })

      // Snapshot previous value
      const previous = queryClient.getQueryData<Media[]>(['media', 'songs'])

      // Optimistically update
      queryClient.setQueryData<Media[]>(['media', 'songs'], (old) =>
        old?.map((s) =>
          s.id === song.id
            ? { ...s, title, metadata: { ...s.metadata as object, artist: artist || null, album: album || null } }
            : s
        )
      )

      onClose()
      return { previous }
    },
    onError: (_err, _vars, context) => {
      // Roll back on error
      if (context?.previous) {
        queryClient.setQueryData(['media', 'songs'], context.previous)
      }
      toast.error('Failed to update song')
    },
    onSuccess: () => {
      toast.success('Song updated')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['media', 'songs'] })
    },
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Edit Song</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Song title"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Artist</label>
            <Input
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="Artist name"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Album</label>
            <Input
              value={album}
              onChange={(e) => setAlbum(e.target.value)}
              placeholder="Album name"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending || !title.trim()}
          >
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}

function DeleteSongDialog({
  song,
  onClose,
}: {
  song: Media
  onClose: () => void
}) {
  const queryClient = useQueryClient()

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE('/api/media/{id}', {
        params: { path: { id: String(song.id) } },
      })
      if (error) throw new Error('Failed to delete')
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['media', 'songs'] })

      const previous = queryClient.getQueryData<Media[]>(['media', 'songs'])

      // Optimistically remove
      queryClient.setQueryData<Media[]>(['media', 'songs'], (old) =>
        old?.filter((s) => s.id !== song.id)
      )

      onClose()
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['media', 'songs'], context.previous)
      }
      toast.error('Failed to delete song')
    },
    onSuccess: () => {
      toast.success('Song deleted')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['media', 'songs'] })
    },
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold mb-2">Delete Song</h2>
        <p className="text-muted-foreground mb-6">
          Are you sure you want to delete "{song.title}"? This action cannot be undone.
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

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
