import createClient from 'openapi-fetch'
import type { paths, operations } from './api-types.js'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export const api = createClient<paths>({
  baseUrl: API_BASE_URL,
})

// Re-export types for convenience
export type Media = operations['getApiMedia']['responses']['200']['content']['application/json'][number]
export type Playlist = operations['getApiPlaylists']['responses']['200']['content']['application/json'][number]
export type PlaylistWithMedia = operations['getApiPlaylistsById']['responses']['200']['content']['application/json']
export type Card = operations['getApiCards']['responses']['200']['content']['application/json'][number]
export type CardLookup = operations['getApiCardsLookupByUid']['responses']['200']['content']['application/json']
export type FirmwareInfo = operations['getApiFirmwareLatest']['responses']['200']['content']['application/json']
export type Device = operations['getApiDevices']['responses']['200']['content']['application/json'][number]

// Helper to extract data or throw on error
export async function unwrap<T>(
  promise: Promise<{ data?: T; error?: { error: string } }>
): Promise<T> {
  const { data, error } = await promise
  if (error) {
    throw new Error(error.error || 'Unknown error')
  }
  return data as T
}
