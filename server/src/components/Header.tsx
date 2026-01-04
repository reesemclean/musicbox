import { ClientOnly, Link } from '@tanstack/react-router'
import { Music } from 'lucide-react'
import { DownloadsPopover } from './DownloadsPopover'
import { Player } from './Player'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-2xl items-center px-8 gap-4">
        <div className="mr-4 flex">
          <Link to="/" className="mr-6 flex items-center space-x-2">
            <Music className="h-6 w-6" />
            <span className="font-bold inline-block">Music Box</span>
          </Link>
        </div>

        {/* Player in the middle - client only to avoid hydration issues */}
        <ClientOnly fallback={null}>
          <Player />
        </ClientOnly>

        <div className="flex flex-1 items-center justify-end space-x-2">
          <nav className="flex items-center">
            <DownloadsPopover />
          </nav>
        </div>
      </div>
    </header>
  )
}
