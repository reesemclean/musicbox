import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import {
  Download,
  Loader2,
  Search,
  Upload as UploadIcon,
  XCircle,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  downloadYTMusicAlbum,
  downloadYTMusicSong,
  getDownloadQueueStatus,
  searchYTMusic,
  searchYTMusicAlbums,
} from '@/services/ytmusicServerFunctions'
import { addSong, getSongs } from '@/services/songsServerFunctions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const downloadQueueOptions = {
  queryKey: ['downloadQueue'],
  queryFn: async () => {
    const result = await getDownloadQueueStatus()
    return result
  },
}

export const Route = createFileRoute('/_library/downloads')({
  component: DownloadsPage,
})

function DownloadsPage() {
  const [activeTab, setActiveTab] = useState('ytmusic')

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Add Media</h1>
        <p className="text-muted-foreground mt-2">
          Search and download music or upload your own files
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="ytmusic">
            <Search className="h-4 w-4 mr-2" />
            YouTube Music
          </TabsTrigger>
          <TabsTrigger value="upload">
            <UploadIcon className="h-4 w-4 mr-2" />
            Upload
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ytmusic" className="mt-6">
          <YTMusicTab />
        </TabsContent>

        <TabsContent value="upload" className="mt-6">
          <UploadTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function YTMusicTab() {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchType, setSearchType] = useState<'songs' | 'albums'>('songs')
  const [searchResults, setSearchResults] = useState<Array<any>>([])
  const [isSearching, setIsSearching] = useState(false)
  const queryClient = useQueryClient()
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const searchSongsFn = useServerFn(searchYTMusic)
  const searchAlbumsFn = useServerFn(searchYTMusicAlbums)
  const downloadFn = useServerFn(downloadYTMusicSong)
  const downloadAlbumFn = useServerFn(downloadYTMusicAlbum)
  const getSongsFn = useServerFn(getSongs)

  const { data: queue = [] } = useQuery({
    ...downloadQueueOptions,
    refetchInterval: 2000,
  })

  // Fetch existing songs to check for duplicates
  const { data: existingSongs = [] } = useQuery({
    queryKey: ['songs'],
    queryFn: getSongsFn,
  })

  // Track previously downloading items to detect completions
  const prevQueueRef = useRef<Array<any>>([])

  useEffect(() => {
    const prevQueue = prevQueueRef.current
    const currentQueue = queue

    // Check for completed downloads (items that were downloading and are now gone)
    prevQueue.forEach((prevItem) => {
      if (
        (prevItem.status === 'downloading' || prevItem.status === 'pending') &&
        !currentQueue.find((item) => item.videoId === prevItem.videoId)
      ) {
        // Item was downloading and is now gone - it completed!
        toast.success(`Download complete: ${prevItem.title}`, {
          description: prevItem.artist,
        })
        // Invalidate songs query so the duplicate check updates immediately
        queryClient.invalidateQueries({ queryKey: ['songs'] })
      }
    })

    // Check for newly failed downloads
    currentQueue.forEach((currentItem) => {
      const prevItem = prevQueue.find(
        (item) => item.videoId === currentItem.videoId,
      )
      if (
        prevItem &&
        prevItem.status !== 'failed' &&
        currentItem.status === 'failed'
      ) {
        toast.error(`Download failed: ${currentItem.title}`, {
          description: currentItem.error || 'Unknown error',
        })
      }
    })

    prevQueueRef.current = currentQueue
  }, [queue])

  const downloadMutation = useMutation({
    mutationFn: async (song: any) => {
      return await downloadFn({
        data: {
          videoId: song.videoId,
          title: song.title,
          artist: song.artists.join(', '),
          album: song.album,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['downloadQueue'] })
    },
  })

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }

    setIsSearching(true)
    try {
      const results =
        searchType === 'songs'
          ? await searchSongsFn({ data: { query: searchQuery } })
          : await searchAlbumsFn({ data: { query: searchQuery } })
      setSearchResults(results)
    } catch (error) {
      console.error('Search failed:', error)
    } finally {
      setIsSearching(false)
    }
  }

  // Debounced search effect
  useEffect(() => {
    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    // Set new timeout
    if (searchQuery.trim()) {
      searchTimeoutRef.current = setTimeout(() => {
        handleSearch()
      }, 500)
    } else {
      setSearchResults([])
    }

    // Cleanup on unmount
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [searchQuery, searchType])

  const isDownloading = (videoId: string) => {
    return queue.some(
      (item) =>
        item.videoId === videoId &&
        (item.status === 'downloading' || item.status === 'pending'),
    )
  }

  const isAlreadyInLibrary = (videoId: string) => {
    return existingSongs.some((song) => song.youtubeVideoId === videoId)
  }

  const albumDownloadMutation = useMutation({
    mutationFn: async (browseId: string) => {
      return await downloadAlbumFn({
        data: {
          browseId,
          createPlaylist: true,
        },
      })
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['downloadQueue'] })
      toast.success(`Album download started`, {
        description: `Downloading ${data.trackCount} tracks from "${data.albumTitle}"`,
      })
    },
    onError: (error) => {
      toast.error('Album download failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    },
  })

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="flex gap-2">
        <Select value={searchType} onValueChange={(v) => setSearchType(v as 'songs' | 'albums')}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="songs">Songs</SelectItem>
            <SelectItem value="albums">Albums</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder={`Search for ${searchType} on YouTube Music...`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1"
        />
        {isSearching && (
          <div className="flex items-center px-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Results */}
      {searchResults.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">
            Search Results ({searchResults.length})
          </h2>
          <div className="space-y-2">
            {searchType === 'songs'
              ? searchResults.map((song, index) => (
                  <div
                    key={song.videoId || `song-${index}`}
                    className="bg-card rounded-lg border p-4 flex items-center gap-4"
                  >
                    {song.thumbnails?.[0] && (
                      <img
                        src={song.thumbnails[0].url}
                        alt={song.title}
                        className="w-16 h-16 rounded object-cover"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{song.title}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {song.artists.join(', ')}
                      </p>
                      {song.album && (
                        <p className="text-xs text-muted-foreground truncate">
                          {song.album}
                        </p>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {song.duration
                        ? `${Math.floor(song.duration / 60)}:${(song.duration % 60).toString().padStart(2, '0')}`
                        : '—'}
                    </div>
                    {isAlreadyInLibrary(song.videoId) ? (
                      <Button disabled variant="secondary" size="sm">
                        Already in Library
                      </Button>
                    ) : (
                      <Button
                        onClick={() => downloadMutation.mutate(song)}
                        disabled={
                          downloadMutation.isPending ||
                          isDownloading(song.videoId)
                        }
                        size="sm"
                      >
                        {isDownloading(song.videoId) ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Downloading
                          </>
                        ) : (
                          <>
                            <Download className="h-4 w-4 mr-2" />
                            Download
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                ))
              : searchResults.map((album: any, index: number) => (
                  <div
                    key={album.browseId || `album-${index}`}
                    className="bg-card rounded-lg border p-4 flex items-center gap-4"
                  >
                    {album.thumbnails?.[0] && (
                      <img
                        src={album.thumbnails[0].url}
                        alt={album.title}
                        className="w-16 h-16 rounded object-cover"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{album.title}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {album.artist}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {album.year && `${album.year} • `}
                        {album.trackCount} tracks
                      </p>
                    </div>
                    <Button
                      onClick={() =>
                        albumDownloadMutation.mutate(album.browseId)
                      }
                      disabled={albumDownloadMutation.isPending}
                      size="sm"
                    >
                      {albumDownloadMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Downloading
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4 mr-2" />
                          Download Album
                        </>
                      )}
                    </Button>
                  </div>
                ))}
          </div>
        </div>
      )}

      {/* Active Downloads */}
      {queue.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Download Queue</h2>
          <div className="space-y-2">
            {queue.map((item) => (
              <div
                key={item.id}
                className="bg-card rounded-lg border p-4 flex items-start gap-3"
              >
                <div className="mt-1">
                  {item.status === 'downloading' && (
                    <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
                  )}
                  {item.status === 'pending' && (
                    <Loader2 className="h-5 w-5 text-muted-foreground" />
                  )}
                  {item.status === 'failed' && (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{item.title}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {item.artist}
                  </p>

                  {item.status === 'downloading' && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span>Downloading</span>
                        <span>{item.progress}%</span>
                      </div>
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {item.status === 'pending' && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Waiting to start...
                    </p>
                  )}

                  {item.status === 'failed' && item.error && (
                    <p className="text-xs text-destructive mt-1">
                      {item.error}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function UploadTab() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [album, setAlbum] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const queryClient = useQueryClient()

  const uploadSongFn = useServerFn(addSong)

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error('No file selected')

      const arrayBuffer = await selectedFile.arrayBuffer()
      // Convert ArrayBuffer to Array for JSON serialization
      const uint8Array = new Uint8Array(arrayBuffer)
      const dataArray = Array.from(uint8Array)

      return await uploadSongFn({
        data: {
          title: title || selectedFile.name,
          artist: artist || undefined,
          album: album || undefined,
          fileData: dataArray as any,
          mimeType: selectedFile.type || 'audio/mpeg',
          fileSize: selectedFile.size,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['songs'] })
      toast.success('Upload complete', {
        description: `"${title}" has been added to your library`,
      })
      // Reset form
      setSelectedFile(null)
      setTitle('')
      setArtist('')
      setAlbum('')
    },
    onError: (error) => {
      console.error('Upload failed:', error)
      toast.error('Upload failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    },
  })

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    const audioFile = files.find((f) => f.type.startsWith('audio/'))

    if (audioFile) {
      setSelectedFile(audioFile)
      // Pre-fill title from filename
      const nameWithoutExt = audioFile.name.replace(/\.[^/.]+$/, '')
      setTitle(nameWithoutExt)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '')
      setTitle(nameWithoutExt)
    }
  }

  return (
    <div className="space-y-6">
      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
          isDragging
            ? 'border-primary bg-accent'
            : 'border-muted-foreground/25 hover:border-muted-foreground/50'
        }`}
      >
        <UploadIcon className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <h3 className="font-semibold text-lg mb-2">
          {selectedFile ? selectedFile.name : 'Drop audio files here'}
        </h3>
        <p className="text-muted-foreground mb-4">or click to browse</p>
        <input
          type="file"
          accept="audio/*"
          onChange={handleFileSelect}
          className="hidden"
          id="file-upload"
        />
        <Button asChild variant="outline">
          <label htmlFor="file-upload" className="cursor-pointer">
            Select File
          </label>
        </Button>
      </div>

      {/* Metadata Form */}
      {selectedFile && (
        <div className="space-y-4 bg-card rounded-lg border p-6">
          <h3 className="font-semibold text-lg mb-4">Song Details</h3>

          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Song title"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="artist">Artist</Label>
            <Input
              id="artist"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="Artist name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="album">Album</Label>
            <Input
              id="album"
              value={album}
              onChange={(e) => setAlbum(e.target.value)}
              placeholder="Album name"
            />
          </div>

          <div className="pt-4 flex gap-2">
            <Button
              onClick={() => uploadMutation.mutate()}
              disabled={!title || uploadMutation.isPending}
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <UploadIcon className="h-4 w-4 mr-2" />
                  Upload Song
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedFile(null)
                setTitle('')
                setArtist('')
                setAlbum('')
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
