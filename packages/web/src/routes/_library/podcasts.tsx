import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Mic,
  Rss,
  RefreshCw,
  Trash2,
  ChevronRight,
  Settings,
  Clock,
  Loader2,
  ExternalLink,
  Download,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import {
  getFeeds,
  getFeedById,
  addFeed,
  updateFeed,
  deleteFeed,
  refreshPodcastFeed,
  refreshAllPodcastFeeds,
} from '@/server/podcasts'

export const Route = createFileRoute('/_library/podcasts')({
  component: PodcastsPage,
})

function PodcastsPage() {
  const queryClient = useQueryClient()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [feedUrl, setFeedUrl] = useState('')
  const [retentionCount, setRetentionCount] = useState('3')

  const { data: feeds = [], isLoading } = useQuery({
    queryKey: ['podcasts'],
    queryFn: () => getFeeds(),
    // Poll every 2 seconds to update episode counts during downloads
    refetchInterval: 2000,
  })

  const addFeedMutation = useMutation({
    mutationFn: async ({ feedUrl, retentionCount }: { feedUrl: string; retentionCount: number }) => {
      return addFeed({ data: { feedUrl, retentionCount } })
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['podcasts'] })
      setAddDialogOpen(false)
      setFeedUrl('')
      setRetentionCount('3')
      toast.success(`Subscribed to ${data.name}`)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to add feed')
    },
  })

  const refreshAllMutation = useMutation({
    mutationFn: () => refreshAllPodcastFeeds(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['podcasts'] })
      toast.success(`Refreshed ${data.succeeded} of ${data.total} feeds`)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to refresh feeds')
    },
  })

  const handleAddFeed = (e: React.FormEvent) => {
    e.preventDefault()
    if (!feedUrl.trim()) return
    addFeedMutation.mutate({
      feedUrl: feedUrl.trim(),
      retentionCount: parseInt(retentionCount),
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Podcasts</h1>
        <div className="flex flex-wrap gap-2">
          {feeds.length > 0 && (
            <Button
              variant="outline"
              onClick={() => refreshAllMutation.mutate()}
              disabled={refreshAllMutation.isPending}
            >
              {refreshAllMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Refresh All
            </Button>
          )}
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Rss className="h-4 w-4 mr-2" />
                Add Feed
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleAddFeed}>
                <DialogHeader>
                  <DialogTitle>Add Podcast Feed</DialogTitle>
                  <DialogDescription>
                    Enter the RSS feed URL for the podcast you want to subscribe to.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="feedUrl">Feed URL</Label>
                    <Input
                      id="feedUrl"
                      type="url"
                      placeholder="https://example.com/feed.xml"
                      value={feedUrl}
                      onChange={(e) => setFeedUrl(e.target.value)}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="retention">Episodes to Keep</Label>
                    <Select value={retentionCount} onValueChange={setRetentionCount}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                          <SelectItem key={n} value={n.toString()}>
                            {n} episode{n !== 1 ? 's' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Older episodes will be automatically deleted.
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAddDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={addFeedMutation.isPending}>
                    {addFeedMutation.isPending && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    Subscribe
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : feeds.length === 0 ? (
        <EmptyState onAddClick={() => setAddDialogOpen(true)} />
      ) : (
        <FeedList feeds={feeds} />
      )}
    </div>
  )
}

function EmptyState({ onAddClick }: { onAddClick: () => void }) {
  return (
    <div className="text-center py-12">
      <Mic className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
      <h2 className="text-lg font-semibold mb-2">No podcast subscriptions</h2>
      <p className="text-muted-foreground mb-4">
        Subscribe to podcasts by adding their RSS feed URL.
      </p>
      <Button onClick={onAddClick}>
        <Rss className="h-4 w-4 mr-2" />
        Add Your First Podcast
      </Button>
    </div>
  )
}

interface Feed {
  id: number
  name: string
  feedUrl: string
  imageUrl: string | null
  retentionCount: number
  lastFetchedAt: Date | null
  createdAt: Date
  episodeCount?: number
}

function FeedList({ feeds }: { feeds: Feed[] }) {
  return (
    <div className="space-y-2">
      {feeds.map((feed) => (
        <FeedCard key={feed.id} feed={feed} />
      ))}
    </div>
  )
}

function FeedCard({ feed }: { feed: Feed }) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editRetention, setEditRetention] = useState(feed.retentionCount.toString())

  const { data: feedDetail } = useQuery({
    queryKey: ['podcast', feed.id],
    queryFn: () => getFeedById({ data: { id: feed.id } }),
    enabled: expanded,
    refetchInterval: (query) => {
      // Poll every 2 seconds if there are pending/downloading episodes
      const episodes = query.state.data?.episodes ?? []
      const hasPending = episodes.some((ep) => {
        const meta = ep.metadata as { downloadStatus?: string } | null
        return meta?.downloadStatus === 'pending' || meta?.downloadStatus === 'downloading'
      })
      return hasPending ? 2000 : false
    },
  })

  const refreshMutation = useMutation({
    mutationFn: () => refreshPodcastFeed({ data: { id: feed.id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['podcasts'] })
      queryClient.invalidateQueries({ queryKey: ['podcast', feed.id] })
      toast.success('Feed refreshed')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to refresh feed')
    },
  })

  const updateMutation = useMutation({
    mutationFn: (retentionCount: number) => updateFeed({ data: { id: feed.id, retentionCount } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['podcasts'] })
      queryClient.invalidateQueries({ queryKey: ['podcast', feed.id] })
      setSettingsOpen(false)
      toast.success('Settings updated')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update feed')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteFeed({ data: { id: feed.id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['podcasts'] })
      toast.success('Podcast removed')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete feed')
    },
  })

  const formatDate = (dateInput: Date | string | null) => {
    if (!dateInput) return 'Never'
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput)
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-4 p-4 cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        {feed.imageUrl ? (
          <img
            src={feed.imageUrl}
            alt={feed.name}
            className="w-16 h-16 rounded object-cover shrink-0"
          />
        ) : (
          <div className="w-16 h-16 rounded bg-muted flex items-center justify-center shrink-0">
            <Mic className="h-8 w-8 text-muted-foreground" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <h3 className="font-semibold truncate">{feed.name}</h3>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>{feed.episodeCount ?? 0} episodes</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Last updated: {formatDate(feed.lastFetchedAt)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation()
              refreshMutation.mutate()
            }}
            disabled={refreshMutation.isPending}
          >
            {refreshMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>

          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => e.stopPropagation()}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <DialogHeader>
                <DialogTitle>Feed Settings</DialogTitle>
                <DialogDescription>
                  Configure retention and other settings for {feed.name}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label>Episodes to Keep</Label>
                  <Select
                    value={editRetention}
                    onValueChange={setEditRetention}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                        <SelectItem key={n} value={n.toString()}>
                          {n} episode{n !== 1 ? 's' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">Feed URL</Label>
                  <div className="flex items-center gap-2">
                    <Input value={feed.feedUrl} readOnly className="text-xs" />
                    <Button
                      variant="ghost"
                      size="icon"
                      asChild
                    >
                      <a href={feed.feedUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (confirm('Remove this podcast and delete all episodes?')) {
                      deleteMutation.mutate()
                      setSettingsOpen(false)
                    }
                  }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Remove Podcast
                </Button>
                <div className="flex-1" />
                <Button
                  variant="outline"
                  onClick={() => setSettingsOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => updateMutation.mutate(parseInt(editRetention))}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <ChevronRight
            className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </div>
      </div>

      {expanded && (
        <div className="border-t bg-muted/30">
          {!feedDetail ? (
            <div className="p-4 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : feedDetail.episodes.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              No episodes downloaded yet
            </div>
          ) : (
            <div className="divide-y">
              {feedDetail.episodes.map((episode) => {
                const metadata = (episode.metadata ?? {}) as { downloadStatus?: string; pubDate?: string }
                const downloadStatus = metadata.downloadStatus || 'complete'
                return (
                  <div key={episode.id} className="p-4 flex items-center gap-4">
                    <div className="shrink-0">
                      {downloadStatus === 'pending' && (
                        <Download className="h-5 w-5 text-muted-foreground" />
                      )}
                      {downloadStatus === 'downloading' && (
                        <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
                      )}
                      {downloadStatus === 'complete' && (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      )}
                      {downloadStatus === 'failed' && (
                        <AlertCircle className="h-5 w-5 text-red-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium truncate">{episode.title}</h4>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        {downloadStatus === 'pending' && (
                          <span>Waiting to download...</span>
                        )}
                        {downloadStatus === 'downloading' && (
                          <span>Downloading...</span>
                        )}
                        {downloadStatus === 'failed' && (
                          <span className="text-red-500">Download failed</span>
                        )}
                        {downloadStatus === 'complete' && (
                          <>
                            {metadata.pubDate && (
                              <span>{formatDate(metadata.pubDate)}</span>
                            )}
                            {episode.duration && (
                              <span>
                                {Math.floor(episode.duration / 60)} min
                              </span>
                            )}
                            {episode.fileSize && (
                              <span>
                                {(episode.fileSize / 1024 / 1024).toFixed(1)} MB
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
