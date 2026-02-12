import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { ClientOnly } from '@tanstack/react-router'
import { Pause, Play, SkipBack, SkipForward, Music } from 'lucide-react'
import { usePlayer } from '@/hooks/usePlayerState'
import { Button } from '@/components/ui/button'
import { getMediaById } from '@/server/media'
import { getPlaylistById, type PlaylistWithItems } from '@/server/playlists'


export function MiniPlayer({ hideWhenEmpty = false }: { hideWhenEmpty?: boolean }) {
  return (
    <ClientOnly fallback={hideWhenEmpty ? null : <MiniPlayerEmpty />}>
      <MiniPlayerInner hideWhenEmpty={hideWhenEmpty} />
    </ClientOnly>
  )
}

function MiniPlayerInner({ hideWhenEmpty = false }: { hideWhenEmpty?: boolean }) {
  const player = usePlayer()
  const audioRef = useRef<HTMLAudioElement>(null)

  // Fetch current media metadata
  const { data: currentMedia, error } = useQuery({
    queryKey: ['media', player.state.currentMediaId],
    queryFn: async () => {
      const result = await getMediaById({ data: { id: player.state.currentMediaId! } })
      return result
    },
    enabled: player.state.currentMediaId !== null,
  })

  // Fetch current playlist if one is playing
  const { data: currentPlaylist } = useQuery({
    queryKey: ['playlist', player.state.currentPlaylistId],
    queryFn: async () => {
      const result = await getPlaylistById({ data: { id: player.state.currentPlaylistId! } })
      return result as PlaylistWithItems
    },
    enabled:
      player.state.currentPlaylistId !== null &&
      player.state.currentPlaylistId !== 0,
  })

  // Create streaming URL (API routes served from same server)
  const audioUrl = player.state.currentMediaId
    ? `/api/media/stream/${player.state.currentMediaId}`
    : null

  // Auto-play when audio is ready and isPlaying is true
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleCanPlay = () => {
      if (player.state.isPlaying && audio.paused) {
        audio.play().catch(console.error)
      }
    }

    const handlePlay = () => {
      if (!player.state.isPlaying) {
        player.togglePlayPause()
      }
    }

    const handlePause = () => {
      if (player.state.isPlaying) {
        player.togglePlayPause()
      }
    }

    audio.addEventListener('canplay', handleCanPlay)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)

    return () => {
      audio.removeEventListener('canplay', handleCanPlay)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
    }
  }, [player.state.isPlaying, player])

  // Control playback based on state
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    if (player.state.isPlaying && audio.paused) {
      audio.play().catch(console.error)
    } else if (!player.state.isPlaying && !audio.paused) {
      audio.pause()
    }
  }, [player.state.isPlaying])

  // Set initial volume and sync changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = player.state.volume
    }
  }, [player.state.volume])

  // Handle song end
  const handleEnded = () => {
    player.next()
  }

  // Handle error loading audio
  const handleError = () => {
    console.error('Failed to load audio, skipping to next')
    if (player.state.queueIndex < player.state.queue.length - 1) {
      player.next()
    } else {
      player.clearPlayer()
    }
  }

  // Show placeholder when no media is selected
  if (player.state.currentMediaId === null) {
    return hideWhenEmpty ? null : <MiniPlayerEmpty />
  }

  // Show error state if media fetch failed
  if (error || !currentMedia || !audioUrl) {
    return hideWhenEmpty ? null : <MiniPlayerEmpty error />
  }

  return (
    <div className="p-3 border-b border-border bg-background/50">
      {/* Audio element - key forces remount on song change */}
      <audio
        key={player.state.currentMediaId}
        ref={audioRef}
        src={audioUrl}
        autoPlay={player.state.isPlaying}
        onEnded={handleEnded}
        onError={handleError}
      />

      <div className="flex flex-col gap-2">
        {/* Song Info */}
        <div className="min-w-0">
          <div className="text-xs font-medium truncate">{currentMedia.title}</div>
          <div className="text-xs text-muted-foreground truncate">
            {(currentMedia.metadata as { artist?: string })?.artist || 'Unknown Artist'}
          </div>
          {player.state.currentPlaylistId !== null && (
            <div className="text-xs text-muted-foreground truncate">
              {player.state.currentPlaylistId === 0
                ? 'All Songs'
                : currentPlaylist?.name || 'Playlist'}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={player.previous}
            disabled={player.state.queueIndex === 0}
          >
            <SkipBack className="h-3 w-3" />
          </Button>

          <Button
            variant="default"
            size="icon"
            className="h-7 w-7"
            onClick={player.togglePlayPause}
          >
            {player.state.isPlaying ? (
              <Pause className="h-3 w-3" />
            ) : (
              <Play className="h-3 w-3" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={player.next}
            disabled={player.state.queueIndex >= player.state.queue.length - 1}
          >
            <SkipForward className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  )
}

interface MiniPlayerEmptyProps {
  error?: boolean
}

function MiniPlayerEmpty({ error = false }: MiniPlayerEmptyProps) {
  return (
    <div className="p-3 border-b border-border bg-background/50">
      <div className="flex flex-col gap-2">
        {/* Info */}
        <div className="min-w-0">
          <div
            className={`text-xs font-medium truncate ${error ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {error ? 'Failed to load' : 'No song playing'}
          </div>
          <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
            <Music className="h-3 w-3" />
            <span>Select a song to play</span>
          </div>
        </div>

        {/* Disabled Controls */}
        <div className="flex items-center justify-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled>
            <SkipBack className="h-3 w-3" />
          </Button>
          <Button variant="default" size="icon" className="h-7 w-7" disabled>
            <Play className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled>
            <SkipForward className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  )
}
