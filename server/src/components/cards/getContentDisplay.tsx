import { Pause, Play, SkipBack, SkipForward, Square } from 'lucide-react'
import type { Card, Playlist, Song } from '@/db/schema'

const actionIcons = {
  play: Play,
  pause: Pause,
  next: SkipForward,
  previous: SkipBack,
  stop: Square,
}

interface GetContentDisplayProps {
  card: Card
  songs: Array<Omit<Song, 'fileData'>>
  playlists: Array<Playlist>
}

export function getContentDisplay({
  card,
  songs,
  playlists,
}: GetContentDisplayProps) {
  if (card.contentType === 'action') {
    const ActionIcon = actionIcons[card.action as keyof typeof actionIcons]
    return (
      <div className="flex items-center">
        <ActionIcon className="h-4 w-4 mr-2" />
        <span className="capitalize">{card.action}</span>
      </div>
    )
  }

  if (card.contentType === 'song') {
    const song = songs.find((s) => s.id.toString() === card.contentPath)
    if (song) {
      return (
        <div>
          <div className="font-medium">{song.title}</div>
          {song.artist && (
            <div className="text-xs text-muted-foreground">{song.artist}</div>
          )}
        </div>
      )
    }
    return (
      <span className="text-muted-foreground">{card.contentPath || '-'}</span>
    )
  }

  const playlist = playlists.find((p) => p.id.toString() === card.contentPath)
  if (playlist) {
    return <span>{playlist.name}</span>
  }
  return (
    <span className="text-muted-foreground">{card.contentPath || '-'}</span>
  )
}
