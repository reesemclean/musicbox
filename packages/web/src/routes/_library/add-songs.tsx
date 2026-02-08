import { useState, useEffect, useRef, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  XCircle,
  Music,
  Disc,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  search,
  searchYouTubeVideos,
  queueSongDownload,
  queueAlbumDownload,
  getQueue,
  retryQueuedDownload,
  removeFromDownloadQueue,
} from "@/server/downloads";

type SongResult = {
  videoId: string;
  title: string;
  artists: string[];
  album?: string | null;
  duration?: number | null;
  thumbnails?: Array<{ url: string; width: number; height: number }>;
};

type AlbumResult = {
  browseId: string;
  title: string;
  artist: string;
  year?: number | null;
  trackCount?: number | null;
  thumbnails?: Array<{ url: string; width: number; height: number }>;
};

type QueueItem = {
  id: number;
  videoId: string;
  title: string;
  artist: string | null;
  album: string | null;
  thumbnailUrl: string | null;
  status: "pending" | "downloading" | "failed";
  progress: number;
  error: string | null;
  createdAt: Date;
};

export const Route = createFileRoute("/_library/add-songs")({
  component: AddSongsPage,
});

function AddSongsPage() {
  const [activeTab, setActiveTab] = useState<
    "youtube" | "youtubeSearch" | "upload"
  >("youtube");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Add Songs</h1>
        <p className="text-muted-foreground mt-1">
          Download from YouTube Music, YouTube, or upload your own files
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Button
          variant={activeTab === "youtube" ? "default" : "outline"}
          onClick={() => setActiveTab("youtube")}
        >
          <Search className="h-4 w-4 mr-2" />
          YouTube Music
        </Button>
        <Button
          variant={activeTab === "youtubeSearch" ? "default" : "outline"}
          onClick={() => setActiveTab("youtubeSearch")}
        >
          <Search className="h-4 w-4 mr-2" />
          YouTube
        </Button>
        <Button
          variant={activeTab === "upload" ? "default" : "outline"}
          onClick={() => setActiveTab("upload")}
        >
          <Upload className="h-4 w-4 mr-2" />
          Upload
        </Button>
      </div>

      {activeTab === "youtube" && <YouTubeMusicTab />}
      {activeTab === "youtubeSearch" && <YouTubeTab />}
      {activeTab === "upload" && <UploadTab />}
    </div>
  );
}

function YouTubeMusicTab() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType] = useState<"songs" | "albums">("songs");
  const [songResults, setSongResults] = useState<SongResult[]>([]);
  const [albumResults, setAlbumResults] = useState<AlbumResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const queryClient = useQueryClient();
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll download queue
  const { data: queue = [] } = useQuery({
    queryKey: ["downloadQueue"],
    queryFn: () => getQueue(),
    refetchInterval: 2000,
  });

  // Track completed downloads for toasts
  const prevQueueRef = useRef<QueueItem[]>([]);
  useEffect(() => {
    const prevQueue = prevQueueRef.current;
    const currentQueue = queue;

    prevQueue.forEach((prevItem) => {
      if (
        (prevItem.status === "downloading" || prevItem.status === "pending") &&
        !currentQueue.find((item) => item.videoId === prevItem.videoId)
      ) {
        toast.success(`Download complete: ${prevItem.title}`);
        queryClient.invalidateQueries({ queryKey: ["media"] });
      }
    });

    currentQueue.forEach((currentItem) => {
      const prevItem = prevQueue.find(
        (item) => item.videoId === currentItem.videoId,
      );
      if (
        prevItem &&
        prevItem.status !== "failed" &&
        currentItem.status === "failed"
      ) {
        toast.error(`Download failed: ${currentItem.title}`, {
          description: currentItem.error || "Unknown error",
        });
      }
    });

    prevQueueRef.current = currentQueue;
  }, [queue, queryClient]);

  // Debounced search
  const performSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSongResults([]);
      setAlbumResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const data = await search({
        data: { query: searchQuery, type: searchType },
      });

      if (searchType === "songs") {
        setSongResults(data as unknown as SongResult[]);
        setAlbumResults([]);
      } else {
        setAlbumResults(data as unknown as AlbumResult[]);
        setSongResults([]);
      }
    } catch (error) {
      console.error("Search failed:", error);
      toast.error("Search failed");
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, searchType]);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (searchQuery.trim()) {
      searchTimeoutRef.current = setTimeout(performSearch, 500);
    } else {
      setSongResults([]);
      setAlbumResults([]);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, searchType, performSearch]);

  const downloadSongMutation = useMutation({
    mutationFn: async (song: SongResult) => {
      await queueSongDownload({
        data: {
          videoId: song.videoId,
          title: song.title,
          artist: song.artists.join(", "),
          album: song.album || undefined,
          thumbnailUrl: song.thumbnails?.[0]?.url,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["downloadQueue"] });
      toast.success("Download started");
    },
    onError: () => {
      toast.error("Failed to start download");
    },
  });

  const downloadAlbumMutation = useMutation({
    mutationFn: async (album: AlbumResult) => {
      return queueAlbumDownload({ data: { browseId: album.browseId } });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["downloadQueue"] });
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      toast.success(`Album download started`, {
        description: `Downloading ${data?.trackCount} tracks from "${data?.albumTitle}"`,
      });
    },
    onError: () => {
      toast.error("Failed to download album");
    },
  });

  const retryMutation = useMutation({
    mutationFn: (id: number) => retryQueuedDownload({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["downloadQueue"] });
      toast.success("Retrying download");
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => removeFromDownloadQueue({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["downloadQueue"] });
      toast.success("Removed from queue");
    },
  });

  const isDownloading = (videoId: string) => {
    return queue.some(
      (item) =>
        item.videoId === videoId &&
        (item.status === "downloading" || item.status === "pending"),
    );
  };

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="flex gap-2">
        <div className="flex border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setSearchType("songs")}
            className={`px-3 py-2 text-sm ${searchType === "songs" ? "bg-accent" : "hover:bg-accent/50"}`}
          >
            Songs
          </button>
          <button
            onClick={() => setSearchType("albums")}
            className={`px-3 py-2 text-sm ${searchType === "albums" ? "bg-accent" : "hover:bg-accent/50"}`}
          >
            Albums
          </button>
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={`Search for ${searchType}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-10"
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Song Results */}
      {songResults.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">
            Songs ({songResults.length})
          </h2>
          <div className="space-y-2">
            {songResults.map((song) => (
              <div
                key={song.videoId}
                className="bg-card rounded-lg border border-border p-4 flex items-center gap-4"
              >
                {song.thumbnails?.[0] ? (
                  <img
                    src={song.thumbnails[0].url}
                    alt={song.title}
                    className="w-12 h-12 rounded object-cover shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded bg-muted flex items-center justify-center shrink-0">
                    <Music className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0 overflow-hidden">
                  <p className="font-medium truncate">{song.title}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {song.artists.join(", ")}
                  </p>
                  {song.album && (
                    <p className="text-xs text-muted-foreground truncate">
                      {song.album}
                    </p>
                  )}
                </div>
                <div className="text-sm text-muted-foreground shrink-0">
                  {song.duration
                    ? `${Math.floor(song.duration / 60)}:${(song.duration % 60).toString().padStart(2, "0")}`
                    : "—"}
                </div>
                <Button
                  className="shrink-0"
                  onClick={() => downloadSongMutation.mutate(song)}
                  disabled={
                    downloadSongMutation.isPending ||
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
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Album Results */}
      {albumResults.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">
            Albums ({albumResults.length})
          </h2>
          <div className="space-y-2">
            {albumResults.map((album) => (
              <div
                key={album.browseId}
                className="bg-card rounded-lg border border-border p-4 flex items-center gap-4"
              >
                {album.thumbnails?.[0] ? (
                  <img
                    src={album.thumbnails[0].url}
                    alt={album.title}
                    className="w-12 h-12 rounded object-cover shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded bg-muted flex items-center justify-center shrink-0">
                    <Disc className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0 overflow-hidden">
                  <p className="font-medium truncate">{album.title}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {album.artist}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {album.year && `${album.year}`}
                    {album.year && album.trackCount && " • "}
                    {album.trackCount && `${album.trackCount} tracks`}
                  </p>
                </div>
                <Button
                  className="shrink-0"
                  onClick={() => downloadAlbumMutation.mutate(album)}
                  disabled={
                    downloadAlbumMutation.isPending &&
                    downloadAlbumMutation.variables?.browseId === album.browseId
                  }
                  size="sm"
                >
                  {downloadAlbumMutation.isPending &&
                  downloadAlbumMutation.variables?.browseId ===
                    album.browseId ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Starting...
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

      {/* Download Queue */}
      {queue.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Download Queue</h2>
          <div className="space-y-2">
            {queue.map((item) => (
              <div
                key={item.id}
                className="bg-card rounded-lg border border-border p-4 flex items-start gap-3"
              >
                <div className="mt-1">
                  {item.status === "downloading" && (
                    <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
                  )}
                  {item.status === "pending" && (
                    <Loader2 className="h-5 w-5 text-muted-foreground" />
                  )}
                  {item.status === "failed" && (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{item.title}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {item.artist}
                  </p>

                  {item.status === "downloading" && (
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

                  {item.status === "pending" && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Waiting to start...
                    </p>
                  )}

                  {item.status === "failed" && item.error && (
                    <p className="text-xs text-destructive mt-1">
                      {item.error}
                    </p>
                  )}
                </div>
                {item.status === "failed" && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => retryMutation.mutate(item.id)}
                      disabled={retryMutation.isPending}
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Retry
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeMutation.mutate(item.id)}
                      disabled={removeMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {songResults.length === 0 &&
        albumResults.length === 0 &&
        queue.length === 0 &&
        !searchQuery && (
          <div className="text-center py-12">
            <Download className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold mb-2">
              Download from YouTube Music
            </h2>
            <p className="text-muted-foreground">
              Search for songs or albums above to download them to your library.
            </p>
          </div>
        )}
    </div>
  );
}

type YouTubeResult = {
  videoId: string;
  title: string;
  channel: string;
  duration: number | null;
  thumbnailUrl: string | null;
};

function YouTubeTab() {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<YouTubeResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const queryClient = useQueryClient();
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll download queue
  const { data: queue = [] } = useQuery({
    queryKey: ["downloadQueue"],
    queryFn: () => getQueue(),
    refetchInterval: 2000,
  });

  const performSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const data = await searchYouTubeVideos({
        data: { query: searchQuery },
      });
      setResults(data as unknown as YouTubeResult[]);
    } catch (error) {
      console.error("YouTube search failed:", error);
      toast.error("YouTube search failed");
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (searchQuery.trim()) {
      searchTimeoutRef.current = setTimeout(performSearch, 500);
    } else {
      setResults([]);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, performSearch]);

  const downloadMutation = useMutation({
    mutationFn: async (result: YouTubeResult) => {
      await queueSongDownload({
        data: {
          videoId: result.videoId,
          title: result.title,
          artist: result.channel,
          thumbnailUrl: result.thumbnailUrl || undefined,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["downloadQueue"] });
      toast.success("Download started");
    },
    onError: () => {
      toast.error("Failed to start download");
    },
  });

  const isDownloading = (videoId: string) => {
    return queue.some(
      (item) =>
        item.videoId === videoId &&
        (item.status === "downloading" || item.status === "pending"),
    );
  };

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search YouTube videos..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 pr-10"
        />
        {isSearching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">
            Videos ({results.length})
          </h2>
          <div className="space-y-2">
            {results.map((result) => (
              <div
                key={result.videoId}
                className="bg-card rounded-lg border border-border p-4 flex items-center gap-4"
              >
                {result.thumbnailUrl ? (
                  <img
                    src={result.thumbnailUrl}
                    alt={result.title}
                    className="w-12 h-12 rounded object-cover shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded bg-muted flex items-center justify-center shrink-0">
                    <Music className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0 overflow-hidden">
                  <p className="font-medium truncate">{result.title}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {result.channel}
                  </p>
                </div>
                <div className="text-sm text-muted-foreground shrink-0">
                  {result.duration
                    ? `${Math.floor(result.duration / 60)}:${(result.duration % 60).toString().padStart(2, "0")}`
                    : "—"}
                </div>
                <Button
                  className="shrink-0"
                  onClick={() => downloadMutation.mutate(result)}
                  disabled={
                    downloadMutation.isPending || isDownloading(result.videoId)
                  }
                  size="sm"
                >
                  {isDownloading(result.videoId) ? (
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
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {results.length === 0 && !searchQuery && (
        <div className="text-center py-12">
          <Download className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold mb-2">Search YouTube</h2>
          <p className="text-muted-foreground">
            Search for videos like audiobooks, stories, and more.
          </p>
        </div>
      )}
    </div>
  );
}

function UploadTab() {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/media/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Upload failed");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["media"] });
      toast.success("Song uploaded successfully");
      setSelectedFile(null);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    },
  });

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("audio/")) {
      setSelectedFile(file);
    } else {
      toast.error("Please drop an audio file");
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          onChange={handleFileSelect}
          className="hidden"
        />
        <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-lg font-medium mb-2">
          {isDragging ? "Drop to upload" : "Click or drag to upload"}
        </p>
        <p className="text-sm text-muted-foreground">
          Supports MP3, M4A, FLAC, WAV, OGG
        </p>
      </div>

      {/* Selected file */}
      {selectedFile && (
        <div className="bg-card rounded-lg border border-border p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded bg-muted flex items-center justify-center">
            <Music className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{selectedFile.name}</p>
            <p className="text-sm text-muted-foreground">
              {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedFile(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => uploadMutation.mutate(selectedFile)}
              disabled={uploadMutation.isPending}
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
