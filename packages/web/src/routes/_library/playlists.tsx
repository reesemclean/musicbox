import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_library/playlists')({
  component: PlaylistsLayout,
})

function PlaylistsLayout() {
  return <Outlet />
}
