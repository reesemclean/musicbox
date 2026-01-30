import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_library/')({
  component: HomePage,
})

function HomePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">All Songs</h1>
      <p className="text-muted-foreground">
        Your music library will appear here.
      </p>
    </div>
  )
}
