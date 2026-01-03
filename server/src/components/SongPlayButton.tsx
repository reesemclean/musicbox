import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePlayer } from '@/hooks/usePlayerState'

interface SongPlayButtonProps {
  songId: number
  songTitle: string
  playlistId: number
  getIsCurrentSong?: () => boolean
  onTogglePlay: () => void
}

export function SongPlayButton({
  songId,
  songTitle,
  playlistId,
  getIsCurrentSong,
  onTogglePlay,
}: SongPlayButtonProps) {
  const player = usePlayer()

  const isCurrent = getIsCurrentSong
    ? getIsCurrentSong()
    : player.state.currentSongId === songId &&
      player.state.currentPlaylistId === playlistId

  const isPlaying = isCurrent && player.state.isPlaying

  return (
    <Button
      variant="ghost"
      size="icon"
      className={`h-8 w-8 transition-opacity ${
        isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}
      onClick={onTogglePlay}
      aria-label={isPlaying ? `Pause ${songTitle}` : `Play ${songTitle}`}
    >
      {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
    </Button>
  )
}
