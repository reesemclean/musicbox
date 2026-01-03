import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { searchYTMusic, downloadYTMusicSong, getDownloadQueueStatus } from '@/services/ytmusicServerFunctions'
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export const Route = createFileRoute('/admin/downloads')({
  component: DownloadsPage,
})

function DownloadsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const queryClient = useQueryClient()

  // Fetch download queue
  const { data: queue } = useSuspenseQuery({
    queryKey: ['downloadQueue'],
    queryFn: async () => {
      const result = await getDownloadQueueStatus()
      return result
    },
    refetchInterval: 2000, // Refresh every 2 seconds
  })

  // Search mutation
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim()) return

    setIsSearching(true)
    try {
      const results = await searchYTMusic({ data: { query: searchQuery } })
      setSearchResults(results)
    } catch (error) {
      console.error('Search failed:', error)
      alert('Search failed. Please try again.')
    } finally {
      setIsSearching(false)
    }
  }

  // Download mutation
  const downloadMutation = useMutation({
    mutationFn: async (song: any) => {
      return await downloadYTMusicSong({
        data: {
          videoId: song.videoId,
          title: song.title,
          artist: song.artists[0] || 'Unknown',
          album: song.album,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['downloadQueue'] })
    },
  })

  const handleDownload = (song: any) => {
    if (confirm(`Download "${song.title}" by ${song.artists.join(', ')}?`)) {
      downloadMutation.mutate(song)
    }
  }

  return (
    <div className="space-y-8">
      {/* Search Section */}
      <div className="bg-slate-800 rounded-lg p-6">
        <h2 className="text-2xl font-bold mb-4">Search YouTube Music</h2>
        <form onSubmit={handleSearch} className="flex gap-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search for songs, artists, albums..."
            className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <button
            type="submit"
            disabled={isSearching}
            className="px-6 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-600 text-white font-semibold rounded-lg transition-colors"
          >
            {isSearching ? 'Searching...' : 'Search'}
          </button>
        </form>

        {/* Search Results */}
        {searchResults.length > 0 && (
          <div className="mt-6 space-y-2">
            <h3 className="text-xl font-semibold mb-3">Results</h3>
            {searchResults.slice(0, 10).map((song, i) => (
              <div
                key={song.videoId}
                className="flex items-center justify-between p-4 bg-slate-700 rounded-lg hover:bg-slate-650 transition-colors"
              >
                <div className="flex-1">
                  <div className="font-semibold">{song.title}</div>
                  <div className="text-sm text-gray-400">
                    {song.artists.join(', ')}
                    {song.album && ` • ${song.album}`}
                    {song.duration && ` • ${Math.floor(song.duration / 60)}:${(song.duration % 60).toString().padStart(2, '0')}`}
                  </div>
                </div>
                <button
                  onClick={() => handleDownload(song)}
                  disabled={downloadMutation.isPending}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-semibold rounded transition-colors"
                >
                  Download
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Download Queue */}
      <div className="bg-slate-800 rounded-lg p-6">
        <h2 className="text-2xl font-bold mb-4">Download Queue</h2>

        {queue && queue.length === 0 ? (
          <p className="text-gray-400">No downloads in queue</p>
        ) : (
          <div className="space-y-2">
            {queue?.map((item: any) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-4 bg-slate-700 rounded-lg"
              >
                <div className="flex-1">
                  <div className="font-semibold">{item.title}</div>
                  <div className="text-sm text-gray-400">
                    {item.artist}
                    {item.album && ` • ${item.album}`}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{item.targetPath}</div>
                </div>
                <div className="flex items-center gap-4">
                  {item.status === 'downloading' && (
                    <div className="flex items-center gap-2">
                      <div className="w-32 h-2 bg-slate-600 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 transition-all duration-300"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      <span className="text-sm text-gray-400">{item.progress}%</span>
                    </div>
                  )}
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      item.status === 'complete'
                        ? 'bg-green-900 text-green-300'
                        : item.status === 'failed'
                        ? 'bg-red-900 text-red-300'
                        : item.status === 'downloading'
                        ? 'bg-blue-900 text-blue-300'
                        : 'bg-gray-700 text-gray-300'
                    }`}
                  >
                    {item.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
