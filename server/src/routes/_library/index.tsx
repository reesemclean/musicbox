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
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">All Songs</h1>
        {selectedSongs.size > 0 && (
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {selectedSongs.size} song{selectedSongs.size !== 1 ? 's' : ''}{' '}
              selected
            </span>
            <PlaylistSelector
              playlists={playlists}
              onSelect={handleAddToPlaylist}
              onCreatePlaylist={handleCreatePlaylist}
              disabled={addSongsMutation.isPending}
            />
          </div>
        )}
      </div>

      {/* Search Input */}
      <div className="mb-4">
        <Input
          placeholder="Search songs by title, artist, or album..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-sm"
        />
      </div>

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
        deletingSongId={deleteSongMutation.isPending ? songToDelete?.id : null}
      />

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
