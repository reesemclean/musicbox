import { useState, useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Music, Search, Loader2, Pencil, Trash2, X, Play, Pause, Plus, Check, ChevronRight, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePlayer } from '@/hooks/usePlayerState'
import { getMedia, updateMedia, deleteMedia } from '@/server/media'
import { getPlaylists, createPlaylist, addMediaToPlaylist } from '@/server/playlists'

type Media = Awaited<ReturnType<typeof getMedia>>[number]
type Playlist = Awaited<ReturnType<typeof getPlaylists>>[number]

const songsQueryOptions = queryOptions({
  queryKey: ['media', 'songs'],
  queryFn: () => getMedia({ data: { type: 'song' } }),
})

const playlistsQueryOptions = queryOptions({
  queryKey: ['playlists'],
  queryFn: () => getPlaylists(),
})

export const Route = createFileRoute('/_library/')({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(songsQueryOptions),
      context.queryClient.ensureQueryData(playlistsQueryOptions),
    ])
  },
  component: SongsLibraryPage,
})

function SongsLibraryPage() {
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState<'none' | 'artist' | 'album'>('none')
  const [selectedSongs, setSelectedSongs] = useState<Set<number>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [editingSong, setEditingSong] = useState<Media | null>(null)
  const [deletingSong, setDeletingSong] = useState<Media | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const player = usePlayer()
  const queryClient = useQueryClient()

  const { data: songs } = useSuspenseQuery(songsQueryOptions)
  const { data: playlists } = useSuspenseQuery(playlistsQueryOptions)

  const handlePlayAll = () => {
    if (!songs.length) return
    player.playPlaylist(0, songs.map((s) => s.id))
  }

  const filteredSongs = useMemo(() => {
    const query = search.toLowerCase()
    return songs.filter((song) =>
      song.title.toLowerCase().includes(query) ||
      (song.metadata as any)?.artist?.toLowerCase().includes(query) ||
      (song.metadata as any)?.album?.toLowerCase().includes(query)
    )
  }, [songs, search])

  // Group songs by artist or album
  const groupedSongs = useMemo(() => {
    if (groupBy === 'none') return null

    const groups = new Map<string, Media[]>()

    filteredSongs.forEach((song) => {
      const metadata = song.metadata as { artist?: string; album?: string } | null
      const key =
        groupBy === 'artist'
          ? metadata?.artist || 'Unknown Artist'
          : metadata?.album || 'Unknown Album'

      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(song)
    })

    // Sort groups alphabetically
    const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
      if (a[0].startsWith('Unknown')) return 1
      if (b[0].startsWith('Unknown')) return -1
      return a[0].localeCompare(b[0])
    })

    return sortedGroups
  }, [filteredSongs, groupBy])

  const toggleSongSelection = (songId: number) => {
    const newSelection = new Set(selectedSongs)
    if (newSelection.has(songId)) {
      newSelection.delete(songId)
    } else {
      newSelection.add(songId)
    }
    setSelectedSongs(newSelection)
  }

  const toggleSelectAll = () => {
    if (selectedSongs.size === filteredSongs.length) {
      setSelectedSongs(new Set())
    } else {
      setSelectedSongs(new Set(filteredSongs.map((s) => s.id)))
    }
  }

  const toggleGroupSelection = (groupSongs: Media[]) => {
    const groupIds = new Set(groupSongs.map((s) => s.id))
    const allSelected = groupSongs.every((s) => selectedSongs.has(s.id))

    const newSelection = new Set(selectedSongs)
    if (allSelected) {
      groupIds.forEach((id) => newSelection.delete(id))
    } else {
      groupIds.forEach((id) => newSelection.add(id))
    }
    setSelectedSongs(newSelection)
  }

  // Add to playlist mutation
  const addToPlaylistMutation = useMutation({
    mutationFn: async ({ playlistId, mediaIds }: { playlistId: number; mediaIds: number[] }) => {
      for (const mediaId of mediaIds) {
        await addMediaToPlaylist({ data: { playlistId, mediaId } })
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] })
      setSelectedSongs(new Set())
      toast.success('Added to playlist')
    },
    onError: () => {
      toast.error('Failed to add to playlist')
    },
  })

  // Create playlist and add songs mutation
  const createPlaylistMutation = useMutation({
    mutationFn: async ({ name, mediaIds }: { name: string; mediaIds: number[] }) => {
      const playlist = await createPlaylist({ data: { name } })

      // Add songs to the new playlist
      for (const mediaId of mediaIds) {
        await addMediaToPlaylist({ data: { playlistId: playlist.id, mediaId } })
      }
      return playlist
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] })
      setSelectedSongs(new Set())
      toast.success('Playlist created')
    },
    onError: () => {
      toast.error('Failed to create playlist')
    },
  })

  // Bulk delete mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: async (mediaIds: number[]) => {
      for (const id of mediaIds) {
        await deleteMedia({ data: { id } })
      }
    },
    onMutate: (mediaIds) => {
      // Clear player if current song is being deleted
      if (player.state.currentMediaId && mediaIds.includes(player.state.currentMediaId)) {
        player.clearPlayer()
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', 'songs'] })
      setSelectedSongs(new Set())
      setBulkDeleteOpen(false)
      toast.success('Songs deleted')
    },
    onError: () => {
      toast.error('Failed to delete songs')
      setBulkDeleteOpen(false)
    },
  })

  const handleAddToPlaylist = (playlistId: number) => {
    addToPlaylistMutation.mutate({
      playlistId,
      mediaIds: Array.from(selectedSongs),
    })
  }

  const handleCreatePlaylist = (name: string) => {
    createPlaylistMutation.mutate({
      name,
      mediaIds: Array.from(selectedSongs),
    })
  }

  return (
    <div className="pb-24">
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
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Group by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No grouping</SelectItem>
              <SelectItem value="artist">Group by Artist</SelectItem>
              <SelectItem value="album">Group by Album</SelectItem>
            </SelectContent>
          </Select>
          {songs.length > 0 && (
            <Button variant="outline" onClick={handlePlayAll}>
              <Play className="h-4 w-4 mr-2" />
              Play All
            </Button>
          )}
        </div>
      </div>

      {songs.length === 0 && <EmptyState />}

      {groupedSongs ? (
        <div className="space-y-2">
          {groupedSongs.map(([groupName, groupSongs]) => {
            const isExpanded = expandedGroups.has(groupName)
            return (
              <div key={groupName}>
                <button
                  onClick={() => {
                    const next = new Set(expandedGroups)
                    if (isExpanded) {
                      next.delete(groupName)
                    } else {
                      next.add(groupName)
                    }
                    setExpandedGroups(next)
                  }}
                  className="flex items-center gap-3 w-full pb-2 border-b border-border text-left cursor-pointer hover:bg-muted/30 rounded-t px-2 py-2 transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-5 w-5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                  )}
                  <h2 className="text-xl font-semibold">{groupName}</h2>
                  <span className="text-sm text-muted-foreground">
                    ({groupSongs.length} song{groupSongs.length !== 1 ? 's' : ''})
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      player.playPlaylist(0, groupSongs.map((s) => s.id))
                    }}
                  >
                    <Play className="h-3 w-3 mr-1" />
                    Play
                  </Button>
                </button>
                {isExpanded && (
                  <SongsTable
                    songs={groupSongs}
                    allSongIds={groupSongs.map((s) => s.id)}
                    selectedSongs={selectedSongs}
                    onToggleSelection={toggleSongSelection}
                    onToggleSelectAll={() => toggleGroupSelection(groupSongs)}
                    onEdit={setEditingSong}
                    onDelete={setDeletingSong}
                  />
                )}
              </div>
            )
          })}
        </div>
      ) : filteredSongs.length > 0 ? (
        <SongsTable
          songs={filteredSongs}
          allSongIds={songs.map((s) => s.id)}
          selectedSongs={selectedSongs}
          onToggleSelection={toggleSongSelection}
          onToggleSelectAll={toggleSelectAll}
          onEdit={setEditingSong}
          onDelete={setDeletingSong}
        />
      ) : songs.length > 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No songs match your search.
        </div>
      ) : null}

      {/* Floating Action Panel */}
      <div
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 bg-accent border border-border rounded-xl shadow-lg transition-all duration-300 z-50 ${
          selectedSongs.size > 0 ? 'translate-y-0 opacity-100' : 'translate-y-16 opacity-0 pointer-events-none'
        }`}
      >
        <div className="px-4 py-3 flex items-center gap-4">
          <span className="text-sm font-medium">
            {selectedSongs.size} song{selectedSongs.size !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={() => setSelectedSongs(new Set())}
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
          >
            Clear
          </button>
          <div className="h-4 w-px bg-border" />
          <PlaylistSelector
            playlists={playlists}
            onSelect={handleAddToPlaylist}
            onCreatePlaylist={handleCreatePlaylist}
            disabled={addToPlaylistMutation.isPending || createPlaylistMutation.isPending}
          />
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setBulkDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>
        </div>
      </div>

      {/* Bulk Delete Confirmation */}
      {bulkDeleteOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background border border-border rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-2">Delete {selectedSongs.size} Songs</h2>
            <p className="text-muted-foreground mb-6">
              Are you sure you want to delete {selectedSongs.size} song{selectedSongs.size !== 1 ? 's' : ''}?
              This will permanently remove them from your library and all playlists.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => bulkDeleteMutation.mutate(Array.from(selectedSongs))}
                disabled={bulkDeleteMutation.isPending}
              >
                {bulkDeleteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Delete
              </Button>
            </div>
          </div>
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

function EmptyState() {
  return (
    <div className="text-center py-12">
      <Music className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
      <h2 className="text-lg font-semibold mb-2">No songs yet</h2>
      <p className="text-muted-foreground">
        Add songs from the Add Songs page.
      </p>
    </div>
  )
}

function PlaylistSelector({
  playlists,
  onSelect,
  onCreatePlaylist,
  disabled,
}: {
  playlists: Playlist[]
  onSelect: (playlistId: number) => void
  onCreatePlaylist: (name: string) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')

  const handleSelect = (id: number) => {
    onSelect(id)
    setOpen(false)
  }

  const handleCreate = () => {
    if (newName.trim()) {
      onCreatePlaylist(newName.trim())
      setNewName('')
      setShowCreate(false)
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <Button
        variant="default"
        size="sm"
        onClick={() => setOpen(!open)}
        disabled={disabled}
      >
        <Plus className="h-4 w-4 mr-1" />
        Add to Playlist
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full mb-2 right-0 w-64 bg-popover border border-border rounded-lg shadow-lg z-50">
            {showCreate ? (
              <div className="p-3">
                <Input
                  placeholder="Playlist name..."
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate()
                    if (e.key === 'Escape') setShowCreate(false)
                  }}
                  autoFocus
                />
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="outline" onClick={() => setShowCreate(false)} className="flex-1">
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleCreate} disabled={!newName.trim()} className="flex-1">
                    Create
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="max-h-48 overflow-y-auto p-1">
                  {playlists.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground text-center">
                      No playlists yet
                    </div>
                  ) : (
                    playlists.map((playlist) => (
                      <button
                        key={playlist.id}
                        onClick={() => handleSelect(playlist.id)}
                        className="w-full text-left px-3 py-2 text-sm rounded hover:bg-accent transition-colors"
                      >
                        {playlist.name}
                      </button>
                    ))
                  )}
                </div>
                <div className="border-t border-border p-1">
                  <button
                    onClick={() => setShowCreate(true)}
                    className="w-full text-left px-3 py-2 text-sm rounded hover:bg-accent transition-colors flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Create new playlist
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SongsTable({
  songs,
  allSongIds,
  selectedSongs,
  onToggleSelection,
  onToggleSelectAll,
  onEdit,
  onDelete,
}: {
  songs: Media[]
  allSongIds: number[]
  selectedSongs: Set<number>
  onToggleSelection: (id: number) => void
  onToggleSelectAll: () => void
  onEdit: (song: Media) => void
  onDelete: (song: Media) => void
}) {
  const player = usePlayer()

  const handlePlay = (song: Media) => {
    const index = allSongIds.indexOf(song.id)
    player.playPlaylist(0, allSongIds, index >= 0 ? index : 0)
  }

  const allSelected = songs.length > 0 && songs.every((s) => selectedSongs.has(s.id))
  const someSelected = songs.some((s) => selectedSongs.has(s.id))

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-muted/50">
          <tr className="text-left text-sm text-muted-foreground">
            <th className="px-4 py-3 font-medium w-10">
              <button
                onClick={onToggleSelectAll}
                className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${
                  allSelected
                    ? 'bg-primary border-primary text-primary-foreground'
                    : someSelected
                    ? 'bg-primary/50 border-primary'
                    : 'border-muted-foreground/30 hover:border-muted-foreground'
                }`}
              >
                {allSelected && <Check className="h-3 w-3" />}
                {someSelected && !allSelected && <div className="h-2 w-2 bg-primary-foreground rounded-sm" />}
              </button>
            </th>
            <th className="px-4 py-3 font-medium w-12"></th>
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
              isSelected={selectedSongs.has(song.id)}
              isPlaying={player.state.currentMediaId === song.id && player.state.isPlaying}
              isCurrent={player.state.currentMediaId === song.id}
              onToggleSelection={() => onToggleSelection(song.id)}
              onPlay={() => handlePlay(song)}
              onToggle={player.togglePlayPause}
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
  isSelected,
  isPlaying,
  isCurrent,
  onToggleSelection,
  onPlay,
  onToggle,
  onEdit,
  onDelete,
}: {
  song: Media
  isSelected: boolean
  isPlaying: boolean
  isCurrent: boolean
  onToggleSelection: () => void
  onPlay: () => void
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const metadata = song.metadata as { artist?: string; album?: string } | null

  return (
    <tr className={`hover:bg-muted/30 transition-colors group ${isCurrent ? 'bg-muted/20' : ''} ${isSelected ? 'bg-primary/5' : ''}`}>
      <td className="px-4 py-3">
        <button
          onClick={onToggleSelection}
          className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${
            isSelected
              ? 'bg-primary border-primary text-primary-foreground'
              : 'border-muted-foreground/30 hover:border-muted-foreground'
          }`}
        >
          {isSelected && <Check className="h-3 w-3" />}
        </button>
      </td>
      <td className="px-4 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={isCurrent ? onToggle : onPlay}
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded flex items-center justify-center ${isCurrent ? 'bg-primary/20' : 'bg-muted'}`}>
            <Music className={`h-5 w-5 ${isCurrent ? 'text-primary' : 'text-muted-foreground'}`} />
          </div>
          <span className={`font-medium ${isCurrent ? 'text-primary' : ''}`}>{song.title}</span>
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
      await updateMedia({
        data: {
          id: song.id,
          title,
          metadata: {
            artist: artist || null,
            album: album || null,
          },
        },
      })
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['media', 'songs'] })
      const previous = queryClient.getQueryData<Media[]>(['media', 'songs'])

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
  const player = usePlayer()

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await deleteMedia({ data: { id: song.id } })
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['media', 'songs'] })
      const previous = queryClient.getQueryData<Media[]>(['media', 'songs'])

      queryClient.setQueryData<Media[]>(['media', 'songs'], (old) =>
        old?.filter((s) => s.id !== song.id)
      )

      // Clear player if deleting current song
      if (player.state.currentMediaId === song.id) {
        player.clearPlayer()
      }

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
