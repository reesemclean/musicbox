import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { usePlayer } from '@/hooks/usePlayerState'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { getPlaylist, getSongMeta } from '@/services/songsServerFunctions'

export function Player() {
  const player = usePlayer()
  const audioRef = useRef<HTMLAudioElement>(null)

  // Fetch current song metadata only (not the file data)
  const {
    data: currentSong,
    error,
    isLoading,
  } = useQuery({
    queryKey: ['song-meta', player.state.currentSongId],
    queryFn: () => getSongMeta({ data: { id: player.state.currentSongId! } }),
    enabled: player.state.currentSongId !== null,
  })

  // Fetch current playlist if one is playing
  const { data: currentPlaylist } = useQuery({
    queryKey: ['playlist', player.state.currentPlaylistId],
    queryFn: () =>
      getPlaylist({ data: { id: player.state.currentPlaylistId! } }),
    enabled:
      player.state.currentPlaylistId !== null &&
      player.state.currentPlaylistId !== 0,
  })

  // Create streaming URL directly (no blob, no memory overhead)
  const audioUrl = player.state.currentSongId
    ? `/api/stream/${player.state.currentSongId}`
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
      // Sync state if audio plays without our control
      if (!player.state.isPlaying) {
        player.togglePlayPause()
      }
    }

    const handlePause = () => {
      // Sync state if audio pauses without our control
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
    player.nextSong()
  }

  // Handle error loading audio (e.g., song was deleted)
  const handleError = () => {
    console.error('Failed to load audio, skipping to next song')
    // Skip to next song if there is one, otherwise clear the player
    if (player.state.queueIndex < player.state.queue.length - 1) {
      player.nextSong()
    } else {
      // At the end or only song in queue, clear player
      player.clearPlayer()
    }
  }

  // Show placeholder when no song is selected
  if (player.state.currentSongId === null) {
    return (
      <div className="flex items-center gap-4 flex-1 max-w-4xl mx-auto">
        {/* Song Info Placeholder */}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-muted-foreground">
            No song playing
          </div>
          <div className="text-sm text-muted-foreground">
            Select a song to start playing
          </div>
        </div>

        {/* Controls - Disabled */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" disabled>
            <SkipBack className="h-4 w-4" />
          </Button>

          <Button variant="default" size="icon" disabled>
            <Play className="h-4 w-4" />
          </Button>

          <Button variant="ghost" size="icon" disabled>
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        {/* Volume - Disabled */}
        <div className="flex items-center gap-2 w-32 opacity-50">
          <Volume2 className="h-4 w-4" />
          <Slider value={[80]} max={100} step={1} className="flex-1" disabled />
        </div>
      </div>
    )
  }

  // Show loading state while fetching song
  if (isLoading) {
    return (
      <div className="flex items-center gap-4 flex-1 max-w-4xl mx-auto">
        <div className="flex-1 text-center text-sm text-muted-foreground">
          Loading song...
        </div>
      </div>
    )
  }

  // Show error state if song fetch failed
  if (error || !currentSong || !audioUrl) {
    return (
      <div className="flex items-center gap-4 flex-1 max-w-4xl mx-auto">
        <div className="flex-1 text-center text-sm text-destructive">
          Failed to load song
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4 flex-1 max-w-4xl mx-auto">
      {/* Audio element - key forces remount on song change */}
      <audio
        key={player.state.currentSongId}
        ref={audioRef}
        src={audioUrl}
        autoPlay={player.state.isPlaying}
        onEnded={handleEnded}
        onError={handleError}
      />

      {/* Song Info */}
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{currentSong.title}</div>
        <div className="text-sm text-muted-foreground truncate">
          {currentSong.artist}
          {player.state.currentPlaylistId !== null && (
            <>
              {' • '}
              {player.state.currentPlaylistId === 0
                ? 'All Songs'
                : currentPlaylist?.name || 'Playlist'}
            </>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={player.previousSong}
          disabled={player.state.queueIndex === 0}
        >
          <SkipBack className="h-4 w-4" />
        </Button>

        <Button variant="default" size="icon" onClick={player.togglePlayPause}>
          {player.state.isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={player.nextSong}
          disabled={player.state.queueIndex >= player.state.queue.length - 1}
        >
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-2 w-32">
        <Volume2 className="h-4 w-4" />
        <Slider
          value={[player.state.volume * 100]}
          onValueChange={([value]) => player.setVolume(value / 100)}
          max={100}
          step={1}
          className="flex-1"
        />
      </div>
    </div>
  )
}
