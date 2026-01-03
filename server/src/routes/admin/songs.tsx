import { createFileRoute } from '@tanstack/react-router'
import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { useRef, useState } from 'react'
import {
  getSongs,
  removeSong,
  streamSong,
} from '@/services/songsServerFunctions'

const songsQueryOptions = queryOptions({
  queryKey: ['songs'],
  queryFn: getSongs,
})

export const Route = createFileRoute('/admin/songs')({
  loader: async ({ context }) => {
    return context.queryClient.ensureQueryData(songsQueryOptions)
  },
  component: SongsPage,
})

function SongsPage() {
  const { data: songs } = useSuspenseQuery(songsQueryOptions)
  const queryClient = useQueryClient()
  const removeSongFn = useServerFn(removeSong)
  const streamSongFn = useServerFn(streamSong)
  const [selectedSong, setSelectedSong] = useState<number | null>(null)
  const [playingSongId, setPlayingSongId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await removeSongFn({ data: { id } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['songs'] })
      setSelectedSong(null)
    },
  })

  const handleDelete = (id: number, title: string) => {
    if (!confirm(`Are you sure you want to delete "${title}"?`)) {
      return
    }
    deleteMutation.mutate(id)
  }

  const handlePlay = async (songId: number) => {
    try {
      // If already playing this song, pause it
      if (
        playingSongId === songId &&
        audioRef.current &&
        !audioRef.current.paused
      ) {
        audioRef.current.pause()
        setPlayingSongId(null)
        return
      }

      // Stop current audio if any
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }

      // Fetch song data
      const songData = await streamSongFn({ data: { id: songId } })

      // Convert base64 to blob
      const byteCharacters = atob(songData.fileData)
      const byteNumbers = new Array(byteCharacters.length)
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i)
      }
      const byteArray = new Uint8Array(byteNumbers)
      const blob = new Blob([byteArray], { type: songData.mimeType })
      const url = URL.createObjectURL(blob)

      // Create and play audio
      const audio = new Audio(url)
      audioRef.current = audio

      audio.onended = () => {
        setPlayingSongId(null)
        URL.revokeObjectURL(url)
      }

      audio.onerror = () => {
        setPlayingSongId(null)
        URL.revokeObjectURL(url)
        alert('Failed to play song')
      }

      await audio.play()
      setPlayingSongId(songId)
    } catch (error) {
      console.error('Failed to play song:', error)
      alert('Failed to play song')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Songs ({songs.length})</h2>
      </div>

      {songs.length === 0 ? (
        <div className="bg-slate-800 rounded-lg p-12 text-center">
          <p className="text-gray-400 text-lg">No songs in your library yet</p>
          <p className="text-gray-500 text-sm mt-2">
            Download songs from the Downloads tab
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {songs.map((song) => (
            <div
              key={song.id}
              className={`bg-slate-800 rounded-lg p-4 hover:bg-slate-750 transition-colors cursor-pointer ${
                selectedSong === song.id ? 'ring-2 ring-amber-500' : ''
              }`}
              onClick={() =>
                setSelectedSong(selectedSong === song.id ? null : song.id)
              }
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold truncate">
                    {song.title}
                  </h3>
                  {song.artist && (
                    <p className="text-gray-400 text-sm">{song.artist}</p>
                  )}
                  {song.album && (
                    <p className="text-gray-500 text-xs">{song.album}</p>
                  )}
                  {song.duration && (
                    <p className="text-gray-500 text-xs mt-1">
                      {formatDuration(song.duration)}
                    </p>
                  )}
                  <p className="text-gray-600 text-xs mt-2 truncate">
                    {song.mimeType} • {(song.fileSize / 1024 / 1024).toFixed(2)}{' '}
                    MB
                  </p>
                </div>
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handlePlay(song.id)
                    }}
                    className={`px-3 py-1 ${
                      playingSongId === song.id
                        ? 'bg-green-600 hover:bg-green-700'
                        : 'bg-blue-600 hover:bg-blue-700'
                    } text-white text-sm font-semibold rounded transition-colors`}
                  >
                    {playingSongId === song.id ? '⏸ Pause' : '▶ Play'}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(song.id, song.title)
                    }}
                    disabled={deleteMutation.isPending}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white text-sm font-semibold rounded transition-colors"
                  >
                    {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
