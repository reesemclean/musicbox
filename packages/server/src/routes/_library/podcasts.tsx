import { createFileRoute } from '@tanstack/react-router'
import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Loader2, MoreHorizontal, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  deletePodcastFeed,
  getAllPodcastFeeds,
  getPodcastEpisodes,
  refreshPodcastFeed,
} from '@/services/serverFunctions'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { AddPodcastDialog } from '@/components/AddPodcastDialog'

interface PodcastFeed {
  feed: {
    id: number
    title: string
    description?: string | null
    imageUrl?: string | null
    author?: string | null
    feedUrl: string
    episodesToKeep?: number | null
    lastFetchedAt?: Date | null
  }
  totalEpisodes: number
  downloadedEpisodes: number
}

const podcastsQueryOptions = queryOptions({
  queryKey: ['podcasts'],
  queryFn: getAllPodcastFeeds,
})

export const Route = createFileRoute('/_library/podcasts')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(podcastsQueryOptions)
  },
  component: PodcastsView,
})

function PodcastsView() {
  const { data: podcasts } = useSuspenseQuery(podcastsQueryOptions)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [feedToDelete, setFeedToDelete] = useState<PodcastFeed | null>(null)
  const [expandedFeed, setExpandedFeed] = useState<number | null>(null)
  const queryClient = useQueryClient()

  const deleteFeedFn = useServerFn(deletePodcastFeed)
  const refreshFeedFn = useServerFn(refreshPodcastFeed)

  const deleteMutation = useMutation({
    mutationFn: (feedId: number) => deleteFeedFn({ data: { feedId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['podcasts'] })
      toast.success('Podcast deleted')
      setFeedToDelete(null)
    },
    onError: (error) => {
      console.error('Failed to delete podcast:', error)
      toast.error('Failed to delete podcast')
    },
  })

  const refreshMutation = useMutation({
    mutationFn: (feedId: number) => refreshFeedFn({ data: { feedId } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['podcasts'] })
      if (result.newEpisodes > 0) {
        toast.success(`Found ${result.newEpisodes} new episode(s)`)
      } else {
        toast.success('Feed is up to date')
      }
    },
    onError: (error) => {
      console.error('Failed to refresh podcast:', error)
      toast.error('Failed to refresh podcast')
    },
  })

  const handleAddSuccess = () => {
    setAddDialogOpen(false)
    queryClient.invalidateQueries({ queryKey: ['podcasts'] })
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Podcasts</h1>
        <Button onClick={() => setAddDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Podcast
        </Button>
      </div>

      {podcasts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg mb-2">No podcasts yet</p>
          <p className="text-sm">
            Add a podcast feed to start listening to episodes
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {podcasts.map((podcast) => (
            <PodcastCard
              key={podcast.feed.id}
              podcast={podcast}
              isExpanded={expandedFeed === podcast.feed.id}
              onToggleExpand={() =>
                setExpandedFeed(
                  expandedFeed === podcast.feed.id ? null : podcast.feed.id,
                )
              }
              onRefresh={() => refreshMutation.mutate(podcast.feed.id)}
              onDelete={() => setFeedToDelete(podcast)}
              isRefreshing={
                refreshMutation.isPending &&
                refreshMutation.variables === podcast.feed.id
              }
            />
          ))}
        </div>
      )}

      <AddPodcastDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSuccess={handleAddSuccess}
      />

      <AlertDialog
        open={!!feedToDelete}
        onOpenChange={(open) => !open && setFeedToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Podcast</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{feedToDelete?.feed.title}"? This
              will remove all downloaded episodes. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                feedToDelete && deleteMutation.mutate(feedToDelete.feed.id)
              }
              disabled={deleteMutation.isPending}
              className={buttonVariants({ variant: 'destructive' })}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface PodcastCardProps {
  podcast: PodcastFeed
  isExpanded: boolean
  onToggleExpand: () => void
  onRefresh: () => void
  onDelete: () => void
  isRefreshing: boolean
}

function PodcastCard({
  podcast,
  isExpanded,
  onToggleExpand,
  onRefresh,
  onDelete,
  isRefreshing,
}: PodcastCardProps) {
  return (
    <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
      <div className="border rounded-lg p-4">
        <div className="flex items-start gap-4">
          {podcast.feed.imageUrl && (
            <img
              src={podcast.feed.imageUrl}
              alt={podcast.feed.title}
              className="w-16 h-16 rounded-lg object-cover"
            />
          )}
          <div className="flex-1 min-w-0">
            <CollapsibleTrigger asChild>
              <button className="text-left w-full">
                <h3 className="font-semibold text-lg truncate hover:underline">
                  {podcast.feed.title}
                </h3>
              </button>
            </CollapsibleTrigger>
            {podcast.feed.author && (
              <p className="text-sm text-muted-foreground truncate">
                {podcast.feed.author}
              </p>
            )}
            <p className="text-sm text-muted-foreground mt-1">
              {podcast.downloadedEpisodes}/{podcast.totalEpisodes} episodes
              downloaded
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <CollapsibleContent>
          <div className="mt-4 pt-4 border-t">
            <EpisodesList feedId={podcast.feed.id} />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

function EpisodesList({ feedId }: { feedId: number }) {
  const getEpisodesFn = useServerFn(getPodcastEpisodes)

  const { data: episodes } = useSuspenseQuery({
    queryKey: ['podcast-episodes', feedId],
    queryFn: () => getEpisodesFn({ data: { feedId } }),
  })

  if (episodes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No episodes yet
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {episodes.map((episode) => (
        <div
          key={episode.id}
          className="flex items-center gap-3 p-2 rounded-md hover:bg-accent"
        >
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{episode.title}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {episode.publishedAt && (
                <span>
                  {new Date(episode.publishedAt).toLocaleDateString()}
                </span>
              )}
              {episode.duration && (
                <span>{Math.floor(episode.duration / 60)} min</span>
              )}
              <span
                className={
                  episode.downloadStatus === 'complete'
                    ? 'text-green-600'
                    : episode.downloadStatus === 'failed'
                      ? 'text-red-600'
                      : 'text-yellow-600'
                }
              >
                {episode.downloadStatus === 'complete'
                  ? 'Downloaded'
                  : episode.downloadStatus === 'failed'
                    ? 'Failed'
                    : episode.downloadStatus === 'downloading'
                      ? 'Downloading...'
                      : 'Pending'}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
