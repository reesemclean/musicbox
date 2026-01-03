import { ClientOnly } from '@tanstack/react-router'
import { Play } from 'lucide-react'
import { SongPlayButton } from './SongPlayButton'
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

interface SongListProps<T extends Song> {
  songs: Array<T>
  playlistId?: number
  renderActions?: (song: T) => React.ReactNode
  emptyMessage?: string
  getRowKey?: (song: T) => string | number
  // Multiselect props
  selectable?: boolean
  selectedSongs?: Set<number>
  onToggleSelection?: (songId: number) => void
  onToggleSelectAll?: () => void
}

export function SongList<T extends Song>({
  songs,
  playlistId = 0,
  renderActions,
  emptyMessage = 'No songs available',
  getRowKey,
  selectable = false,
  selectedSongs = new Set(),
  onToggleSelection,
  onToggleSelectAll,
}: SongListProps<T>) {
  const player = usePlayer()

  const handlePlaySong = (song: T) => {
    const songIds = songs.map((s) => s.id)
    const songIndex = songIds.indexOf(song.id)
    const rowKey = getRowKey ? getRowKey(song) : song.id
    player.playPlaylist(playlistId, songIds, songIndex, rowKey)
  }

  const handleTogglePlay = (song: T) => {
    const rowKey = getRowKey ? getRowKey(song) : song.id
    // If this song is currently playing, toggle play/pause
    if (
      player.state.currentSongId === song.id &&
      player.state.currentPlaylistId === playlistId &&
      player.state.currentRowKey === rowKey
    ) {
      player.togglePlayPause()
    } else {
      // Otherwise, play the song
      handlePlaySong(song)
    }
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
            const isSelected = selectedSongs.has(song.id)
            const rowKey = getRowKey ? getRowKey(song) : song.id

            return (
              <tr
                key={rowKey}
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
                  <ClientOnly
                    fallback={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100"
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                    }
                  >
                    <SongPlayButton
                      songId={song.id}
                      songTitle={song.title}
                      playlistId={playlistId}
                      getIsCurrentSong={() =>
                        player.state.currentSongId === song.id &&
                        player.state.currentPlaylistId === playlistId &&
                        player.state.currentRowKey === rowKey
                      }
                      onTogglePlay={() => handleTogglePlay(song)}
                    />
                  </ClientOnly>
                </td>
                <td
                  className="p-4 cursor-pointer"
                  onClick={() => handlePlaySong(song)}
                >
                  <div className="font-medium">{song.title}</div>
                </td>
                <td
                  className="p-4 text-muted-foreground cursor-pointer"
                  onClick={() => handlePlaySong(song)}
                >
                  {song.artist || '—'}
                </td>
                <td
                  className="p-4 text-muted-foreground cursor-pointer"
                  onClick={() => handlePlaySong(song)}
                >
                  {song.album || '—'}
                </td>
                <td
                  className="p-4 text-right text-muted-foreground cursor-pointer"
                  onClick={() => handlePlaySong(song)}
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
