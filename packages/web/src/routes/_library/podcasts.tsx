import { createFileRoute } from '@tanstack/react-router'
import { Mic, Rss } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/_library/podcasts')({
  component: PodcastsPage,
})

function PodcastsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Podcasts</h1>
        <Button disabled>
          <Rss className="h-4 w-4 mr-2" />
          Add Feed
        </Button>
      </div>

      <EmptyState />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="text-center py-12">
      <Mic className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
      <h2 className="text-lg font-semibold mb-2">No podcast subscriptions</h2>
      <p className="text-muted-foreground mb-4">
        Subscribe to podcasts by adding their RSS feed URL.
      </p>
      <p className="text-sm text-muted-foreground">
        Coming soon - RSS feed parsing not yet implemented.
      </p>
    </div>
  )
}
