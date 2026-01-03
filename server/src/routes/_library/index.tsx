import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { getSongs } from '@/services/songsServerFunctions'
import { usePlayer } from '@/hooks/usePlayerState'
import { Button } from '@/components/ui/button'

const songsQueryOptions = queryOptions({
  queryKey: ['songs'],
  queryFn: getSongs,
})

export const Route = createFileRoute('/_library/')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(songsQueryOptions)
  },
  component: AllSongsView,
})

function AllSongsView() {
  const { data: songs } = useSuspenseQuery(songsQueryOptions)
  const player = usePlayer()

  const handlePlaySong = (songId: number) => {
    // Play the song and set the queue to all songs
    const songIds = songs.map((s) => s.id)
    const songIndex = songIds.indexOf(songId)
    player.playPlaylist(0, songIds, songIndex) // 0 for "all songs" virtual playlist
  }

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">All Songs</h1>
      <div className="bg-card rounded-lg border">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="w-12"></th>
              <th className="text-left p-4 font-medium">Title</th>
              <th className="text-left p-4 font-medium">Artist</th>
              <th className="text-left p-4 font-medium">Album</th>
              <th className="text-right p-4 font-medium">Duration</th>
            </tr>
          </thead>
          <tbody>
            {songs.map((song) => (
              <tr
                key={song.id}
                className="border-b last:border-0 hover:bg-accent/50 group"
              >
                <td className="p-2 text-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handlePlaySong(song.id)}
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                </td>
                <td className="p-4">{song.title}</td>
                <td className="p-4 text-muted-foreground">{song.artist}</td>
                <td className="p-4 text-muted-foreground">{song.album}</td>
                <td className="p-4 text-right text-muted-foreground">
                  {song.duration || '--:--'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {songs.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No songs in your library
          </div>
        )}
      </div>
    </div>
  )
}
