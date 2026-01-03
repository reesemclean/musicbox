import { spawn } from 'node:child_process'

export interface YTMusicSearchResult {
  videoId: string
  title: string
  artists: Array<string>
  album?: string
  duration?: number
  thumbnails?: Array<{ url: string; width: number; height: number }>
}

export interface YTMusicAlbum {
  browseId: string
  title: string
  artist: string
  year?: number
  trackCount?: number
  tracks: Array<YTMusicAlbumTrack>
}

export interface YTMusicAlbumTrack {
  videoId: string
  title: string
  artists: Array<string>
  album?: string
  duration?: number
}

/**
 * Search YouTube Music for songs
 */
export async function searchSongs(
  query: string,
): Promise<Array<YTMusicSearchResult>> {
  return new Promise((resolve, reject) => {
    const python = spawn('python3', [
      '-c',
      `
import json
import sys
from ytmusicapi import YTMusic

ytmusic = YTMusic()
results = ytmusic.search("${query.replace(/"/g, '\\"')}", filter="songs", limit=20)

songs = []
for result in results:
    songs.append({
        "videoId": result.get("videoId"),
        "title": result.get("title"),
        "artists": [artist.get("name") for artist in result.get("artists", [])],
        "album": result.get("album", {}).get("name") if result.get("album") else None,
        "duration": result.get("duration_seconds"),
        "thumbnails": result.get("thumbnails", [])
    })

print(json.dumps(songs))
`,
    ])

    let stdout = ''
    let stderr = ''

    python.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    python.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    python.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python process exited with code ${code}: ${stderr}`))
        return
      }

      try {
        const results = JSON.parse(stdout)
        resolve(results)
      } catch (error) {
        reject(new Error(`Failed to parse ytmusicapi response: ${error}`))
      }
    })

    python.on('error', (error) => {
      reject(new Error(`Failed to spawn Python process: ${error.message}`))
    })
  })
}

/**
 * Get album details and track listing
 */
export async function getAlbum(browseId: string): Promise<YTMusicAlbum> {
  return new Promise((resolve, reject) => {
    const python = spawn('python3', [
      '-c',
      `
import json
import sys
from ytmusicapi import YTMusic

ytmusic = YTMusic()
album = ytmusic.get_album("${browseId.replace(/"/g, '\\"')}")

tracks = []
for track in album.get("tracks", []):
    tracks.append({
        "videoId": track.get("videoId"),
        "title": track.get("title"),
        "artists": [artist.get("name") for artist in track.get("artists", [])],
        "album": album.get("title"),
        "duration": track.get("duration_seconds")
    })

result = {
    "browseId": album.get("audioPlaylistId"),
    "title": album.get("title"),
    "artist": album.get("artists", [{}])[0].get("name", "Unknown"),
    "year": album.get("year"),
    "trackCount": album.get("trackCount"),
    "tracks": tracks
}

print(json.dumps(result))
`,
    ])

    let stdout = ''
    let stderr = ''

    python.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    python.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    python.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python process exited with code ${code}: ${stderr}`))
        return
      }

      try {
        const result = JSON.parse(stdout)
        resolve(result)
      } catch (error) {
        reject(new Error(`Failed to parse ytmusicapi response: ${error}`))
      }
    })

    python.on('error', (error) => {
      reject(new Error(`Failed to spawn Python process: ${error.message}`))
    })
  })
}
