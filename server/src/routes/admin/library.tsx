import { createFileRoute } from '@tanstack/react-router'
import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import {
  deleteSong,
  getLibraryContents,
  uploadSong,
} from '@/services/libraryServerFunctions'

const libraryQueryOptions = queryOptions({
  queryKey: ['library'],
  queryFn: getLibraryContents,
})

export const Route = createFileRoute('/admin/library')({
  loader: async ({ context }) => {
    return context.queryClient.ensureQueryData(libraryQueryOptions)
  },
  component: LibraryPage,
})

function LibraryPage() {
  const {
    data: library,
    refetch,
    isFetching,
  } = useSuspenseQuery(libraryQueryOptions)

  return (
    <div className="space-y-6">
      <LibraryTab library={library} refetch={refetch} isFetching={isFetching} />
      <UploadTab onSuccess={() => refetch()} />
    </div>
  )
}

function LibraryTab({ library, refetch, isFetching }: any) {
  const queryClient = useQueryClient()
  const deleteSongFn = useServerFn(deleteSong)

  const deleteMutation = useMutation({
    mutationFn: async (songPath: string) => {
      return await deleteSongFn({ data: { songPath } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library'] })
    },
  })

  const handleRefresh = async () => {
    await refetch()
  }

  const handleDelete = (songPath: string) => {
    if (!confirm('Are you sure you want to delete this song?')) {
      return
    }

    deleteMutation.mutate(songPath)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={handleRefresh}
          disabled={isFetching}
          className="px-6 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-600 text-white font-semibold rounded-lg transition-colors"
        >
          {isFetching ? 'Refreshing...' : 'Refresh Library'}
        </button>
        {isFetching && (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-amber-500 font-medium">
              Loading...
            </span>
          </div>
        )}
      </div>
      {library && (
        <div className="bg-slate-800 rounded-lg p-6 overflow-x-auto">
          <h2 className="text-xl font-bold mb-4">
            Songs ({library.songs?.length || 0})
          </h2>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-700">
              <tr>
                <th className="text-left py-2 px-3">Filename</th>
                <th className="text-left py-2 px-3">Path</th>
                <th className="text-right py-2 px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {library.songs?.map((song: any) => (
                <tr
                  key={song.path}
                  className="border-b border-slate-700 hover:bg-slate-700"
                >
                  <td className="py-2 px-3">{song.filename}</td>
                  <td className="py-2 px-3 text-gray-400 text-xs">
                    {song.path}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <button
                      onClick={() => handleDelete(song.path)}
                      disabled={deleteMutation.isPending}
                      className="px-3 py-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white text-xs font-semibold rounded transition-colors"
                    >
                      {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(!library.songs || library.songs.length === 0) && (
            <div className="text-center py-8 text-gray-400">No songs found</div>
          )}
        </div>
      )}
    </div>
  )
}

function UploadTab({ onSuccess }: { onSuccess: () => void }) {
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const upload = useServerFn(uploadSong)

  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setUploading(true)
    setMessage('')
    const form = e.currentTarget
    try {
      const formData = new FormData(form)
      const result = await upload({ data: formData })
      setMessage(`✅ Uploaded: ${result.filename}`)
      form.reset()
      onSuccess()
    } catch (error) {
      setMessage(
        `❌ Error: ${error instanceof Error ? error.message : 'Upload failed'}`,
      )
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-bold mb-4">Upload Music</h2>
      <form
        onSubmit={handleUpload}
        className="bg-slate-800 rounded-lg p-6 space-y-4"
      >
        <div>
          <label className="block text-sm font-semibold mb-2">
            Select Audio File
          </label>
          <input
            type="file"
            name="file"
            accept=".mp3,.m4a,.flac,.wav,.ogg"
            required
            className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
          />
        </div>
        <button
          type="submit"
          disabled={uploading}
          className="w-full px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-600 text-white font-semibold rounded-lg"
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
        {message && <div className="text-sm mt-2">{message}</div>}
      </form>
    </div>
  )
}
