import { Radio } from 'lucide-react'
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface NFCScanWaitingProps {
  onCancel: () => void
}

export function NFCScanWaiting({ onCancel }: NFCScanWaitingProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Scan NFC Card</DialogTitle>
        <DialogDescription>
          Tap an NFC card to the reader to register it
        </DialogDescription>
      </DialogHeader>

      <div className="py-12 flex flex-col items-center justify-center">
        <Radio className="h-16 w-16 mb-4 text-amber-500 animate-pulse" />
        <p className="text-lg font-semibold mb-2">
          Waiting for NFC card scan...
        </p>
        <p className="text-sm text-muted-foreground">
          Tap an NFC card to the reader
        </p>
        <p className="text-xs text-muted-foreground mt-4">
          Or run:{' '}
          <code className="bg-muted px-2 py-1 rounded">
            npm run simulate-nfc
          </code>
        </p>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  )
}
