import { createFileRoute } from '@tanstack/react-router'
import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { useMemo, useState } from 'react'
import {
  addPlaylist,
  addSongToPlaylistFn,
  getPlaylists,
  getSongs,
} from '@/services/songsServerFunctions'
import { SongList } from '@/components/SongList'
import { Input } from '@/components/ui/input'
import { PlaylistSelector } from '@/components/PlaylistSelector'

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
  const queryClient = useQueryClient()

  const addSongFn = useServerFn(addSongToPlaylistFn)
  const createPlaylistFn = useServerFn(addPlaylist)

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
      />
    </div>
  )
}
