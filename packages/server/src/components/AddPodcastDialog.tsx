import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { addPodcastFeed } from '@/services/serverFunctions'

interface AddPodcastDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function AddPodcastDialog({
  open,
  onOpenChange,
  onSuccess,
}: AddPodcastDialogProps) {
  const [feedUrl, setFeedUrl] = useState('')

  const addFeedFn = useServerFn(addPodcastFeed)

  const mutation = useMutation({
    mutationFn: (url: string) => addFeedFn({ data: { feedUrl: url } }),
    onSuccess: (result) => {
      toast.success(
        `Added "${result.feed.title}" with ${result.episodeCount} episodes`,
      )
      setFeedUrl('')
      onSuccess()
    },
    onError: (error) => {
      console.error('Failed to add podcast:', error)
      if (error instanceof Error) {
        if (error.message.includes('already exists')) {
          toast.error('This podcast is already in your library')
        } else if (error.message.includes('Failed to fetch')) {
          toast.error('Could not fetch feed. Check the URL and try again.')
        } else {
          toast.error(`Failed to add podcast: ${error.message}`)
        }
      } else {
        toast.error('Failed to add podcast')
      }
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!feedUrl.trim()) {
      toast.error('Please enter a feed URL')
      return
    }
    mutation.mutate(feedUrl.trim())
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setFeedUrl('')
    }
    onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Podcast</DialogTitle>
            <DialogDescription>
              Enter the RSS feed URL for the podcast you want to add.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="feed-url">Feed URL</Label>
              <Input
                id="feed-url"
                type="url"
                placeholder="https://example.com/podcast/feed.xml"
                value={feedUrl}
                onChange={(e) => setFeedUrl(e.target.value)}
                disabled={mutation.isPending}
              />
              <p className="text-xs text-muted-foreground">
                You can usually find this on the podcast's website or by
                searching for the podcast name + "RSS feed"
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || !feedUrl.trim()}>
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Podcast'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
