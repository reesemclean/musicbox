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
import { useState } from 'react'
import {
  addSongToPlaylistFn,
  getPlaylist,
  getSongs,
  removeSongFromPlaylistFn,
} from '@/services/songsServerFunctions'
import { Button } from '@/components/ui/button'

const songsQueryOptions = queryOptions({
  queryKey: ['songs'],
  queryFn: getSongs,
})

export const Route = createFileRoute('/_library/playlist/$id')({
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(songsQueryOptions)
    const playlistId = parseInt(params.id)
    await context.queryClient.ensureQueryData({
      queryKey: ['playlist', playlistId],
      queryFn: async () => {
        return await getPlaylist({ data: { id: playlistId } })
      },
    })
  },
  component: PlaylistView,
})

function PlaylistView() {
  const { id } = Route.useParams()
  const playlistId = parseInt(id)

  const { data: playlist } = useQuery({
    queryKey: ['playlist', playlistId],
    queryFn: async () => {
      return await getPlaylist({ data: { id: playlistId } })
    },
  })

  const { data: allSongs } = useSuspenseQuery(songsQueryOptions)
  const [showAddSong, setShowAddSong] = useState(false)
  const queryClient = useQueryClient()

  const addSongFn = useServerFn(addSongToPlaylistFn)
  const removeSongFn = useServerFn(removeSongFromPlaylistFn)

  const addSongMutation = useMutation({
    mutationFn: async (songId: number) => {
      return await addSongFn({ data: { playlistId, songId } })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['playlist', playlistId],
      })
      setShowAddSong(false)
    },
  })

  const removeSongMutation = useMutation({
    mutationFn: async (songId: number) => {
      return await removeSongFn({ data: { playlistId, songId } })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['playlist', playlistId],
      })
    },
  })

  if (!playlist) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  const songsInPlaylist = playlist.songs || []
  const availableSongs = allSongs.filter(
    (song) => !songsInPlaylist.find((ps: any) => ps.id === song.id),
  )

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">{playlist.name}</h1>
        <Button onClick={() => setShowAddSong(!showAddSong)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Song
        </Button>
      </div>

      {showAddSong && availableSongs.length > 0 && (
        <div className="mb-6 p-4 bg-card rounded-lg border">
          <h3 className="font-semibold mb-3">Add a song to this playlist</h3>
          <div className="space-y-2 max-h-64 overflow-auto">
            {availableSongs.map((song) => (
              <button
                key={song.id}
                onClick={() => addSongMutation.mutate(song.id)}
                disabled={addSongMutation.isPending}
                className="w-full flex items-center justify-between p-2 hover:bg-accent rounded-lg text-left transition-colors"
              >
                <div>
                  <div className="font-medium">{song.title}</div>
                  <div className="text-sm text-muted-foreground">
                    {song.artist}
                  </div>
                </div>
                <Plus className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card rounded-lg border">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left p-4 font-medium">Title</th>
              <th className="text-left p-4 font-medium">Artist</th>
              <th className="text-left p-4 font-medium">Album</th>
              <th className="text-right p-4 font-medium">Duration</th>
              <th className="text-right p-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {songsInPlaylist.map((song: any) => (
              <tr
                key={song.id}
                className="border-b last:border-0 hover:bg-accent/50"
              >
                <td className="p-4">{song.title}</td>
                <td className="p-4 text-muted-foreground">{song.artist}</td>
                <td className="p-4 text-muted-foreground">{song.album}</td>
                <td className="p-4 text-right text-muted-foreground">
                  {song.duration || '--:--'}
                </td>
                <td className="p-4 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeSongMutation.mutate(song.id)}
                    disabled={removeSongMutation.isPending}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {songsInPlaylist.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No songs in this playlist. Click "Add Song" to get started.
          </div>
        )}
      </div>
    </div>
  )
}
