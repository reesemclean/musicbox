#!/usr/bin/env tsx

/**
 * Test script for YouTube Music integration
 * Run with: nix develop --command npx tsx server/src/scripts/test-ytmusic.ts
 */

import { searchSongs } from '../services/ytmusicService'

async function main() {
  console.log('🎵 Testing YouTube Music Search\n')

  try {
    console.log('Searching for "Radiohead Creep"...')
    const results = await searchSongs('Radiohead Creep')

    console.log(`\n✅ Found ${results.length} results:\n`)

    results.slice(0, 5).forEach((song, i) => {
      console.log(`${i + 1}. ${song.title}`)
      console.log(`   Artist: ${song.artists.join(', ')}`)
      console.log(`   Album: ${song.album || 'N/A'}`)
      console.log(`   Video ID: ${song.videoId}`)
      console.log(`   Duration: ${song.duration ? `${song.duration}s` : 'N/A'}`)
      console.log()
    })

    console.log('✅ YouTube Music search working!')
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

main()
