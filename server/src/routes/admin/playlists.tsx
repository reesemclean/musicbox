import { createFileRoute } from '@tanstack/react-router'
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import {
  addPlaylist,
  addSongToPlaylistFn,
  getPlaylist,
  getPlaylists,
  getSongs,
  removePlaylist,
  removeSongFromPlaylistFn,
} from '@/services/songsServerFunctions'

const playlistsQueryOptions = queryOptions({
  queryKey: ['playlists'],
  queryFn: getPlaylists,
})

const songsQueryOptions = queryOptions({
  queryKey: ['songs'],
  queryFn: getSongs,
})

export const Route = createFileRoute('/admin/playlists')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(playlistsQueryOptions)
    await context.queryClient.ensureQueryData(songsQueryOptions)
  },
  component: PlaylistsPage,
})

function PlaylistsPage() {
  const { data: playlists } = useSuspenseQuery(playlistsQueryOptions)
  const { data: songs } = useSuspenseQuery(songsQueryOptions)
  const [selectedPlaylist, setSelectedPlaylist] = useState<number | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showAddSong, setShowAddSong] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const queryClient = useQueryClient()

  const createPlaylistFn = useServerFn(addPlaylist)
  const deletePlaylistFn = useServerFn(removePlaylist)
  const addSongFn = useServerFn(addSongToPlaylistFn)
  const removeSongFn = useServerFn(removeSongFromPlaylistFn)

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      return await createPlaylistFn({ data: { name } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] })
      setNewPlaylistName('')
      setShowCreateForm(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await deletePlaylistFn({ data: { id } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] })
      setSelectedPlaylist(null)
    },
  })

  const addSongMutation = useMutation({
    mutationFn: async (data: { playlistId: number; songId: number }) => {
      return await addSongFn({ data })
    },
    // Return a Promise from invalidation to keep mutation in pending state during refetch
    onSettled: async (_, error, variables) => {
      if (error) {
        console.error('Failed to add song to playlist:', error)
      }
      // Invalidate and refetch the specific playlist query
      await queryClient.invalidateQueries({
        queryKey: ['playlist', variables.playlistId],
      })
      // Also invalidate playlists list in case counts changed
      await queryClient.invalidateQueries({
        queryKey: ['playlists'],
      })
      setShowAddSong(false)
    },
  })

  const removeSongMutation = useMutation({
    mutationFn: async (data: { playlistId: number; songId: number }) => {
      return await removeSongFn({ data })
    },
    // Return a Promise from invalidation to keep mutation in pending state during refetch
    onSettled: async (_, error, variables) => {
      if (error) {
        console.error('Failed to remove song from playlist:', error)
      }
      // Invalidate and refetch the specific playlist query
      await queryClient.invalidateQueries({
        queryKey: ['playlist', variables.playlistId],
      })
      // Also invalidate playlists list in case counts changed
      await queryClient.invalidateQueries({
        queryKey: ['playlists'],
      })
    },
  })

  const handleCreate = () => {
    if (!newPlaylistName.trim()) return
    createMutation.mutate(newPlaylistName)
  }

  const handleDelete = (id: number, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) {
      return
    }
    deleteMutation.mutate(id)
  }

  const handleAddSong = (songId: number) => {
    if (!selectedPlaylist) return
    addSongMutation.mutate({ playlistId: selectedPlaylist, songId })
  }

  const handleRemoveSong = (songId: number) => {
    if (!selectedPlaylist) return
    if (!confirm('Remove this song from the playlist?')) return
    removeSongMutation.mutate({ playlistId: selectedPlaylist, songId })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Playlists ({playlists.length})</h2>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg transition-colors"
        >
          Create Playlist
        </button>
      </div>

      {showCreateForm && (
        <div className="bg-slate-800 rounded-lg p-4">
          <h3 className="text-lg font-semibold mb-3">New Playlist</h3>
          <div className="flex gap-3">
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="Playlist name"
              className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <button
              onClick={handleCreate}
              disabled={!newPlaylistName.trim() || createMutation.isPending}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-semibold rounded-lg transition-colors"
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white font-semibold rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {playlists.length === 0 ? (
        <div className="bg-slate-800 rounded-lg p-12 text-center">
          <p className="text-gray-400 text-lg">No playlists yet</p>
          <p className="text-gray-500 text-sm mt-2">
            Create a playlist to get started
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {playlists.map((playlist) => (
            <PlaylistCard
              key={playlist.id}
              playlist={playlist}
              isSelected={selectedPlaylist === playlist.id}
              onSelect={() =>
                setSelectedPlaylist(
                  selectedPlaylist === playlist.id ? null : playlist.id,
                )
              }
              onDelete={() => handleDelete(playlist.id, playlist.name)}
              onAddSong={() => setShowAddSong(true)}
              onRemoveSong={handleRemoveSong}
              songs={songs}
              showAddSong={showAddSong && selectedPlaylist === playlist.id}
              onCancelAddSong={() => setShowAddSong(false)}
              onSelectSong={handleAddSong}
              deleteMutation={deleteMutation}
              addSongMutation={addSongMutation}
              removeSongMutation={removeSongMutation}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PlaylistCard({
  playlist,
  isSelected,
  onSelect,
  onDelete,
  onAddSong,
  onRemoveSong,
  songs,
  showAddSong,
  onCancelAddSong,
  onSelectSong,
  deleteMutation,
  addSongMutation,
  removeSongMutation,
}: any) {
  const getPlaylistFn = useServerFn(getPlaylist)

  // Use TanStack Query to fetch and cache playlist data - only when selected
  const { data: playlistData, isLoading: loading } = useQuery({
    queryKey: ['playlist', playlist.id],
    queryFn: async () => {
      return await getPlaylistFn({ data: { id: playlist.id } })
    },
    enabled: isSelected, // Only fetch when expanded
  })

  // Get pending additions for this playlist from mutation state
  const pendingAdditions =
    addSongMutation.isPending &&
    addSongMutation.variables?.playlistId === playlist.id
      ? [addSongMutation.variables.songId]
      : []

  // Get pending removals for this playlist from mutation state
  const pendingRemovals =
    removeSongMutation.isPending &&
    removeSongMutation.variables?.playlistId === playlist.id
      ? [removeSongMutation.variables.songId]
      : []

  // Filter out pending removals and include pending additions
  const displayedSongs = playlistData?.songs
    ? [
        ...playlistData.songs.filter(
          (song) => !pendingRemovals.includes(song.id),
        ),
        ...pendingAdditions
          .map((id) => songs.find((s: any) => s.id === id))
          .filter(Boolean)
          .map((song: any) => ({ ...song, pending: true })),
      ]
    : []

  const availableSongs =
    isSelected && playlistData
      ? songs.filter(
          (song: any) =>
            !playlistData.songs.some((ps: any) => ps.id === song.id) &&
            !pendingAdditions.includes(song.id),
        )
      : []

  return (
    <div
      className={`bg-slate-800 rounded-lg p-4 transition-colors ${
        isSelected ? 'ring-2 ring-amber-500' : ''
      }`}
    >
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={onSelect}
      >
        <div>
          <h3 className="text-lg font-semibold">{playlist.name}</h3>
          <p className="text-gray-400 text-sm">
            {playlistData
              ? `${playlistData.songs.length} songs`
              : 'Click to view'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            disabled={deleteMutation.isPending}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white text-sm font-semibold rounded transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {isSelected && (
        <div className="mt-4 pt-4 border-t border-slate-700">
          {loading ? (
            <p className="text-gray-400 text-sm">Loading...</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold">
                  Songs ({displayedSongs.length})
                </h4>
                <button
                  onClick={onAddSong}
                  className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded transition-colors"
                >
                  Add Song
                </button>
              </div>

              {showAddSong && (
                <div className="mb-4 p-3 bg-slate-700 rounded-lg">
                  <h5 className="text-sm font-semibold mb-2">Select a song:</h5>
                  <div className="max-h-60 overflow-y-auto space-y-1">
                    {availableSongs.length === 0 ? (
                      <p className="text-gray-400 text-sm">
                        All songs are already in this playlist
                      </p>
                    ) : (
                      availableSongs.map((song: any) => (
                        <button
                          key={song.id}
                          onClick={() => onSelectSong(song.id)}
                          className="w-full text-left px-3 py-2 bg-slate-600 hover:bg-slate-500 rounded transition-colors text-sm"
                        >
                          <div className="font-medium">{song.title}</div>
                          {song.artist && (
                            <div className="text-gray-400 text-xs">
                              {song.artist}
                            </div>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  <button
                    onClick={onCancelAddSong}
                    className="mt-2 px-3 py-1 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {displayedSongs.length === 0 ? (
                <p className="text-gray-400 text-sm">
                  No songs in this playlist
                </p>
              ) : (
                <div className="space-y-2">
                  {displayedSongs.map((song: any) => (
                    <div
                      key={song.id}
                      className={`flex items-center justify-between p-2 bg-slate-700 rounded ${
                        song.pending ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {song.title}
                          {song.pending && (
                            <span className="ml-2 text-xs text-amber-400">
                              Adding...
                            </span>
                          )}
                        </p>
                        {song.artist && (
                          <p className="text-gray-400 text-xs">{song.artist}</p>
                        )}
                      </div>
                      {!song.pending && (
                        <button
                          onClick={() => onRemoveSong(song.id)}
                          className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded transition-colors ml-2"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
