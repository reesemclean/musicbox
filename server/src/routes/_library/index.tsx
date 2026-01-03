import { createFileRoute } from '@tanstack/react-router'
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  addSongToPlaylistFn,
  getPlaylists,
  getSongs,
} from '@/services/songsServerFunctions'
import { SongList, type Song } from '@/components/SongList'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
  const { data: playlists } = useQuery(playlistsQueryOptions)
  const [selectedSongs, setSelectedSongs] = useState<Set<number>>(new Set())
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const queryClient = useQueryClient()
  const addSongFn = useServerFn(addSongToPlaylistFn)

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
        songIds.map((songId) =>
          addSongFn({ data: { playlistId, songId } }),
        ),
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playlists'] })
      setSelectedSongs(new Set())
      setShowAddToPlaylist(false)
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
            <Button
              variant="default"
              size="sm"
              onClick={() => setShowAddToPlaylist(!showAddToPlaylist)}
              disabled={addSongsMutation.isPending}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add to Playlist
            </Button>
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

      {showAddToPlaylist && playlists && playlists.length > 0 && (
        <div className="mb-6 p-4 bg-card rounded-lg border">
          <h3 className="font-semibold mb-3">Select a playlist</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {playlists.map((playlist) => (
              <Button
                key={playlist.id}
                variant="outline"
                onClick={() => handleAddToPlaylist(playlist.id)}
                disabled={addSongsMutation.isPending}
                className="justify-start"
              >
                {playlist.name}
              </Button>
            ))}
          </div>
        </div>
      )}

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
