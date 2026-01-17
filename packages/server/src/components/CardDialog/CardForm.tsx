import { Loader2 } from 'lucide-react'
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ContentPicker } from '@/components/ContentPicker'

interface CardFormProps {
  mode: 'create' | 'update'
  isEditingExisting: boolean
  nfcId: string
  contentType: 'song' | 'playlist' | 'action'
  contentValue: string | null
  songs: Array<any>
  playlists: Array<any>
  isLoading: boolean
  onContentTypeChange: (value: 'song' | 'playlist' | 'action') => void
  onContentValueChange: (value: string | null) => void
  onCancel: () => void
  onSave: () => void
}

export function CardForm({
  mode,
  isEditingExisting,
  nfcId,
  contentType,
  contentValue,
  songs,
  playlists,
  isLoading,
  onContentTypeChange,
  onContentValueChange,
  onCancel,
  onSave,
}: CardFormProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {mode === 'create' && !isEditingExisting
            ? 'Register NFC Card'
            : 'Edit NFC Card'}
        </DialogTitle>
        <DialogDescription>
          {mode === 'create' && !isEditingExisting
            ? 'Assign content to this NFC card'
            : isEditingExisting
              ? '⚠️ This card is already registered. You are now editing it.'
              : 'Update the content assigned to this card'}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
        {/* NFC ID Display */}
        <div className="space-y-2">
          <Label>NFC Card ID</Label>
          <div className="px-3 py-2 bg-muted rounded-md font-mono text-sm text-amber-500">
            {nfcId}
          </div>
        </div>

        {/* Content Type Selector */}
        <div className="space-y-2">
          <Label htmlFor="content-type">Content Type</Label>
          <Select value={contentType} onValueChange={onContentTypeChange}>
            <SelectTrigger id="content-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="song">Song</SelectItem>
              <SelectItem value="playlist">Playlist</SelectItem>
              <SelectItem value="action">Action</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Content Picker */}
        <div className="space-y-2">
          <Label>
            {contentType === 'song'
              ? 'Song'
              : contentType === 'playlist'
                ? 'Playlist'
                : 'Action'}
          </Label>
          <ContentPicker
            contentType={contentType}
            value={contentValue}
            onChange={onContentValueChange}
            songs={songs}
            playlists={playlists}
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
        <Button onClick={onSave} disabled={isLoading || !contentValue}>
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {mode === 'create' && !isEditingExisting
                ? 'Registering...'
                : 'Updating...'}
            </>
          ) : mode === 'create' && !isEditingExisting ? (
            'Register Card'
          ) : (
            'Update Card'
          )}
        </Button>
      </DialogFooter>
    </>
  )
}
