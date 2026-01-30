import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export const Route = createFileRoute('/_library/')({
  component: HomePage,
})

function HomePage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const { data, error } = await api.GET('/health')
      if (error) throw new Error('Failed to connect')
      return data
    },
  })

  const health = data

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">All Songs</h1>
      <p className="text-muted-foreground mb-4">
        Your music library will appear here.
      </p>

      {/* API Health Check */}
      <div className="mt-8 p-4 rounded-lg border border-border">
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">API Status</h2>
        {isLoading && <p className="text-sm">Checking...</p>}
        {error && (
          <p className="text-sm text-destructive">
            Error: {error instanceof Error ? error.message : 'Failed to connect'}
          </p>
        )}
        {health && (
          <p className="text-sm text-green-500">
            Connected - Status: {health.status}
          </p>
        )}
      </div>
    </div>
  )
}
