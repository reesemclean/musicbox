import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { usePlayer } from '@/hooks/usePlayerState'

export interface Song {
  id: number
  title: string
  artist?: string | null
  album?: string | null
  duration?: number | string | null
}

interface SongListProps {
  songs: Array<Song>
  playlistId?: number
  renderActions?: (song: Song) => React.ReactNode
  emptyMessage?: string
  // Multiselect props
  selectable?: boolean
  selectedSongs?: Set<number>
  onToggleSelection?: (songId: number) => void
  onToggleSelectAll?: () => void
}

export function SongList({
  songs,
  playlistId = 0,
  renderActions,
  emptyMessage = 'No songs available',
  selectable = false,
  selectedSongs = new Set(),
  onToggleSelection,
  onToggleSelectAll,
}: SongListProps) {
  const player = usePlayer()

  const handlePlaySong = (songId: number) => {
    const songIds = songs.map((s) => s.id)
    const songIndex = songIds.indexOf(songId)
    player.playPlaylist(playlistId, songIds, songIndex)
  }

  const handleTogglePlay = (songId: number) => {
    // If this song is currently playing, toggle play/pause
    if (
      player.state.currentSongId === songId &&
      player.state.currentPlaylistId === playlistId
    ) {
      player.togglePlayPause()
    } else {
      // Otherwise, play the song
      handlePlaySong(songId)
    }
  }

  const isCurrentSong = (songId: number) => {
    return (
      player.state.currentSongId === songId &&
      player.state.currentPlaylistId === playlistId
    )
  }

  const allSelected = songs.length > 0 && selectedSongs.size === songs.length

  if (songs.length === 0) {
    return (
      <div className="bg-card rounded-lg border">
        <div className="text-center py-12 text-muted-foreground">
          {emptyMessage}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card rounded-lg border">
      <table className="w-full">
        <thead>
          <tr className="border-b">
            {selectable && (
              <th className="w-12 p-4">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={onToggleSelectAll}
                  aria-label="Select all songs"
                />
              </th>
            )}
            <th className="w-12"></th>
            <th className="text-left p-4 font-medium">Title</th>
            <th className="text-left p-4 font-medium">Artist</th>
            <th className="text-left p-4 font-medium">Album</th>
            <th className="text-right p-4 font-medium">Duration</th>
            {renderActions && (
              <th className="text-right p-4 font-medium">Actions</th>
            )}
          </tr>
        </thead>
        <tbody>
          {songs.map((song) => {
            const isCurrent = isCurrentSong(song.id)
            const isPlaying = isCurrent && player.state.isPlaying
            const isSelected = selectedSongs.has(song.id)

            return (
              <tr
                key={song.id}
                className="border-b last:border-0 hover:bg-accent/50 transition-colors group"
              >
                {selectable && (
                  <td className="p-4">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => onToggleSelection?.(song.id)}
                      aria-label={`Select ${song.title}`}
                    />
                  </td>
                )}
                <td className="p-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-8 w-8 transition-opacity ${
                      isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    onClick={() => handleTogglePlay(song.id)}
                    aria-label={
                      isPlaying ? `Pause ${song.title}` : `Play ${song.title}`
                    }
                  >
                    {isPlaying ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                </td>
                <td
                  className="p-4 cursor-pointer"
                  onClick={() => handlePlaySong(song.id)}
                >
                  <div className={`font-medium ${isCurrent ? 'text-primary' : ''}`}>
                    {song.title}
                  </div>
                </td>
                <td
                  className="p-4 text-muted-foreground cursor-pointer"
                  onClick={() => handlePlaySong(song.id)}
                >
                  {song.artist || '—'}
                </td>
                <td
                  className="p-4 text-muted-foreground cursor-pointer"
                  onClick={() => handlePlaySong(song.id)}
                >
                  {song.album || '—'}
                </td>
                <td
                  className="p-4 text-right text-muted-foreground cursor-pointer"
                  onClick={() => handlePlaySong(song.id)}
                >
                  {song.duration || '—'}
                </td>
                {renderActions && (
                  <td className="p-4 text-right">{renderActions(song)}</td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
