import { createFileRoute } from '@tanstack/react-router'
import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { useMemo, useState } from 'react'
import type { Song } from '@/components/SongList'
import { SongList } from '@/components/SongList'
import {
  addPlaylist,
  addSongToPlaylistFn,
  getPlaylists,
  getSongs,
  removeSong,
} from '@/services/songsServerFunctions'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PlaylistSelector } from '@/components/PlaylistSelector'
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
import { usePlayer } from '@/hooks/usePlayerState'
import { buttonVariants } from '@/components/ui/button'

const songsQueryOptions = queryOptions({
  queryKey: ['songs'],
  queryFn: getSongs,
})

const playlistsQueryOptions = queryOptions({
  queryKey: ['playlists'],
  queryFn: getPlaylists,
})

export const Route = createFileRoute('/_library/')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(songsQueryOptions)
    await context.queryClient.ensureQueryData(playlistsQueryOptions)
  },
  component: AllSongsView,
})

function AllSongsView() {
  const { data: songs } = useSuspenseQuery(songsQueryOptions)
  const { data: playlists } = useSuspenseQuery(playlistsQueryOptions)
  const [selectedSongs, setSelectedSongs] = useState<Set<number>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [groupBy, setGroupBy] = useState<'none' | 'artist' | 'album'>('none')
  const [songToDelete, setSongToDelete] = useState<Song | null>(null)
  const queryClient = useQueryClient()
  const player = usePlayer()

  const addSongFn = useServerFn(addSongToPlaylistFn)
  const createPlaylistFn = useServerFn(addPlaylist)
  const deleteSongFn = useServerFn(removeSong)

  // Filter songs based on search query
  const filteredSongs = useMemo(() => {
    if (!searchQuery) return songs

    const query = searchQuery.toLowerCase()
    return songs.filter(
      (song) =>
        song.title.toLowerCase().includes(query) ||
        song.artist?.toLowerCase().includes(query) ||
        song.album?.toLowerCase().includes(query),
    )
  }, [songs, searchQuery])

  // Group songs by artist or album
  const groupedSongs = useMemo(() => {
    if (groupBy === 'none') return null

    const groups = new Map<string, Array<Song>>()

    filteredSongs.forEach((song) => {
      const key =
        groupBy === 'artist'
          ? song.artist || 'Unknown Artist'
          : song.album || 'Unknown Album'

      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(song)
    })

    // Sort groups: Unknown first, then alphabetically
    const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => {
      const unknownA = a.startsWith('Unknown')
      const unknownB = b.startsWith('Unknown')
      if (unknownA && !unknownB) return -1
      if (!unknownA && unknownB) return 1
      return a.localeCompare(b)
    })

    // Sort songs within each group alphabetically by title
    sortedGroups.forEach(([, groupSongs]) => {
      groupSongs.sort((a, b) => a.title.localeCompare(b.title))
    })

    return sortedGroups
  }, [filteredSongs, groupBy])

  const addSongsMutation = useMutation({
    mutationFn: async ({
      playlistId,
      songIds,
    }: {
      playlistId: number
      songIds: Array<number>
    }) => {
      // Add each song to the playlist
      await Promise.all(
        songIds.map((songId) => addSongFn({ data: { playlistId, songId } })),
      )
      return playlistId
    },
    onSuccess: async (playlistId) => {
      // Invalidate both the playlists list and the specific playlist
      await queryClient.invalidateQueries({ queryKey: ['playlists'] })
      await queryClient.invalidateQueries({
        queryKey: ['playlist', playlistId],
      })
      setSelectedSongs(new Set())
    },
  })

  const createPlaylistMutation = useMutation({
    mutationFn: async (data: { name: string; songIds: Array<number> }) => {
      const playlist = await createPlaylistFn({ data: { name: data.name } })
      return { playlist, songIds: data.songIds }
    },
    onSuccess: async ({ playlist, songIds }) => {
      await queryClient.invalidateQueries({ queryKey: ['playlists'] })
      // Add selected songs to the newly created playlist
      if (songIds.length > 0) {
        await Promise.all(
          songIds.map((songId) =>
            addSongFn({ data: { playlistId: playlist.id, songId } }),
          ),
        )
        // Invalidate the new playlist's query
        await queryClient.invalidateQueries({
          queryKey: ['playlist', playlist.id],
        })
      }
    },
  })

  const deleteSongMutation = useMutation({
    mutationFn: async (songId: number) => {
      await deleteSongFn({ data: { id: songId } })
      return songId
    },
    onMutate: (songId) => {
      // If deleting currently playing song, handle it
      if (player.state.currentSongId === songId) {
        if (player.state.queueIndex < player.state.queue.length - 1) {
          player.nextSong()
        } else {
          player.clearPlayer()
        }
      }
    },
    onSuccess: async () => {
      // Invalidate all song-related queries
      await queryClient.invalidateQueries({ queryKey: ['songs'] })
      await queryClient.invalidateQueries({ queryKey: ['playlists'] })
      setSongToDelete(null)
    },
    onError: (error) => {
      console.error('Failed to delete song:', error)
      setSongToDelete(null)
    },
  })

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
    if (selectedSongs.size === songs.length) {
      setSelectedSongs(new Set())
    } else {
      setSelectedSongs(new Set(songs.map((s) => s.id)))
    }
  }

  const toggleGroupSelection = (groupSongs: Array<Song>) => {
    const groupIds = new Set(groupSongs.map((s) => s.id))
    const allSelected = groupSongs.every((s) => selectedSongs.has(s.id))

    const newSelection = new Set(selectedSongs)
    if (allSelected) {
      // Deselect all songs in group
      groupIds.forEach((id) => newSelection.delete(id))
    } else {
      // Select all songs in group
      groupIds.forEach((id) => newSelection.add(id))
    }
    setSelectedSongs(newSelection)
  }

  const handleAddToPlaylist = (playlistId: number) => {
    addSongsMutation.mutate({
      playlistId,
      songIds: Array.from(selectedSongs),
    })
  }

  const handleCreatePlaylist = (name: string) => {
    const songIds = Array.from(selectedSongs)
    setSelectedSongs(new Set()) // Clear immediately to prevent double-adding
    createPlaylistMutation.mutate({ name, songIds })
  }

  const handleDeleteSong = (song: Song) => {
    setSongToDelete(song)
  }

  const confirmDeleteSong = () => {
    if (songToDelete) {
      deleteSongMutation.mutate(songToDelete.id)
    }
  }

  return (
    <div className="p-6 pb-32">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">All Songs</h1>
      </div>

      {/* Search Input and Grouping */}
      <div className="mb-4 flex gap-2">
        <Input
          placeholder="Search songs by title, artist, or album..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-sm"
        />
        <Select
          value={groupBy}
          onValueChange={(v) => setGroupBy(v as typeof groupBy)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Group by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No grouping</SelectItem>
            <SelectItem value="artist">Group by Artist</SelectItem>
            <SelectItem value="album">Group by Album</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {groupedSongs ? (
        <div className="space-y-6">
          {groupedSongs.map(([groupName, groupSongs]) => (
            <div key={groupName}>
              <div className="flex items-center gap-3 mb-3 pb-2 border-b">
                <h2 className="text-xl font-semibold">{groupName}</h2>
                <span className="text-sm text-muted-foreground">
                  ({groupSongs.length} song{groupSongs.length !== 1 ? 's' : ''})
                </span>
              </div>
              <SongList
                songs={groupSongs}
                playlistId={0}
                emptyMessage=""
                selectable={true}
                selectedSongs={selectedSongs}
                onToggleSelection={toggleSongSelection}
                onToggleSelectAll={() => toggleGroupSelection(groupSongs)}
                onDeleteSong={handleDeleteSong}
                deletingSongId={
                  deleteSongMutation.isPending ? songToDelete?.id : null
                }
              />
            </div>
          ))}
        </div>
      ) : (
        <SongList
          songs={filteredSongs}
          playlistId={0}
          emptyMessage={
            searchQuery
              ? `No songs found matching "${searchQuery}"`
              : 'No songs in your library'
          }
          selectable={true}
          selectedSongs={selectedSongs}
          onToggleSelection={toggleSongSelection}
          onToggleSelectAll={toggleSelectAll}
          onDeleteSong={handleDeleteSong}
          deletingSongId={
            deleteSongMutation.isPending ? songToDelete?.id : null
          }
        />
      )}

      {/* Floating Action Panel */}
      <div
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 min-w-150 bg-accent border-2 border-accent-foreground/10 rounded-2xl shadow-2xl transition-transform duration-300 ease-in-out z-50 ${
          selectedSongs.size > 0 ? 'translate-y-0' : 'translate-y-32'
        }`}
      >
        <div className="px-6 py-4 flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <span className="text-base font-semibold">
              {selectedSongs.size} song{selectedSongs.size !== 1 ? 's' : ''}{' '}
              selected
            </span>
            <button
              onClick={() => setSelectedSongs(new Set())}
              className="text-sm text-muted-foreground hover:text-foreground font-medium underline underline-offset-4"
            >
              Clear
            </button>
          </div>
          <PlaylistSelector
            playlists={playlists}
            onSelect={handleAddToPlaylist}
            onCreatePlaylist={handleCreatePlaylist}
            disabled={addSongsMutation.isPending}
          />
        </div>
      </div>

      <AlertDialog
        open={!!songToDelete}
        onOpenChange={(open) => !open && setSongToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Song</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{songToDelete?.title}"? This will
              permanently remove the song from your library and all playlists.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSongMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteSong}
              disabled={deleteSongMutation.isPending}
              className={buttonVariants({ variant: 'destructive' })}
            >
              {deleteSongMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
