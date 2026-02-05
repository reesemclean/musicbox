import { spawn } from 'node:child_process'

export interface YTMusicSearchResult {
  videoId: string
  title: string
  artists: string[]
  album?: string
  duration?: number
  thumbnails?: Array<{ url: string; width: number; height: number }>
}

export interface YTMusicAlbumSearchResult {
  browseId: string
  title: string
  artist: string
  year?: number
  trackCount?: number
  thumbnails?: Array<{ url: string; width: number; height: number }>
}

/**
 * Search YouTube Music for songs using ytmusicapi (Python)
 */
export async function searchSongs(query: string): Promise<YTMusicSearchResult[]> {
  return new Promise((resolve, reject) => {
    const escapedQuery = query.replace(/"/g, '\\"').replace(/\\/g, '\\\\')

    const python = spawn('python3', [
      '-c',
      `
import json
import sys
from ytmusicapi import YTMusic

ytmusic = YTMusic()
results = ytmusic.search("${escapedQuery}", filter="songs", limit=20)

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
      reject(new Error(`Failed to spawn Python process: ${error.message}. Make sure Python 3 and ytmusicapi are installed.`))
    })
  })
}

export interface YTMusicAlbum {
  browseId: string
  title: string
  artist: string
  year?: number
  trackCount?: number
  tracks: YTMusicSearchResult[]
}

/**
 * Get album details with tracks using ytmusicapi (Python)
 */
export async function getAlbum(browseId: string): Promise<YTMusicAlbum> {
  return new Promise((resolve, reject) => {
    const escapedBrowseId = browseId.replace(/"/g, '\\"').replace(/\\/g, '\\\\')

    const python = spawn('python3', [
      '-c',
      `
import json
import sys
from ytmusicapi import YTMusic

ytmusic = YTMusic()
album = ytmusic.get_album("${escapedBrowseId}")

tracks = []
for track in album.get("tracks", []):
    tracks.append({
        "videoId": track.get("videoId"),
        "title": track.get("title"),
        "artists": [artist.get("name") for artist in track.get("artists", [])],
        "album": album.get("title"),
        "duration": track.get("duration_seconds"),
        "thumbnails": track.get("thumbnails", [])
    })

result = {
    "browseId": album.get("audioPlaylistId"),
    "title": album.get("title"),
    "artist": album.get("artists", [{}])[0].get("name", "Unknown") if album.get("artists") else "Unknown",
    "year": album.get("year"),
    "trackCount": len(tracks),
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
      reject(new Error(`Failed to spawn Python process: ${error.message}. Make sure Python 3 and ytmusicapi are installed.`))
    })
  })
}

/**
 * Search YouTube Music for albums using ytmusicapi (Python)
 */
export async function searchAlbums(query: string): Promise<YTMusicAlbumSearchResult[]> {
  return new Promise((resolve, reject) => {
    const escapedQuery = query.replace(/"/g, '\\"').replace(/\\/g, '\\\\')

    const python = spawn('python3', [
      '-c',
      `
import json
import sys
from ytmusicapi import YTMusic

ytmusic = YTMusic()
results = ytmusic.search("${escapedQuery}", filter="albums", limit=20)

albums = []
for result in results:
    albums.append({
        "browseId": result.get("browseId"),
        "title": result.get("title"),
        "artist": result.get("artists", [{}])[0].get("name", "Unknown") if result.get("artists") else "Unknown",
        "year": result.get("year"),
        "trackCount": result.get("trackCount"),
        "thumbnails": result.get("thumbnails", [])
    })

print(json.dumps(albums))
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
      reject(new Error(`Failed to spawn Python process: ${error.message}. Make sure Python 3 and ytmusicapi are installed.`))
    })
  })
}
