/**
 * NFC Scan Simulator CLI
 *
 * Simulates an NFC card tap from the player device.
 * This sends a scan event to the server which returns the card mapping.
 *
 * Usage:
 *   npm run simulate-nfc                    # Random card ID
 *   npm run simulate-nfc 04:A3:2F:BA       # Specific card ID
 */

import type { NFCScanResponse, NFCScanErrorResponse } from "shared";

const deviceName = process.env.DEVICE_NAME || "dev-player";
const serverUrl = process.env.SERVER_URL || "http://localhost:3000";

async function simulateNFCScan(nfcId?: string) {
  const cardId = nfcId || `nfc-${Date.now()}`;

  console.log("🎯 Simulating NFC card scan...");
  console.log(`   Device: ${deviceName}`);
  console.log(`   Card ID: ${cardId}`);
  console.log(`   Server: ${serverUrl}`);

  try {
    const response = await fetch(`${serverUrl}/api/nfc/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceId: deviceName,
        nfcId: cardId,
      }),
    });

    if (!response.ok && response.status !== 422) {
      console.error("❌ Failed to scan card");
      console.error(`   Status: ${response.status}`);
      const text = await response.text();
      console.error(`   Error: ${text}`);
      process.exit(1);
    }

    let result: NFCScanResponse | NFCScanErrorResponse;
    try {
      result = (await response.json()) as
        | NFCScanResponse
        | NFCScanErrorResponse;
    } catch {
      console.error("❌ Invalid response from server");
      console.error(`   Status: ${response.status}`);
      console.error(`   The server returned non-JSON content`);
      process.exit(1);
    }

    if (response.ok && "success" in result) {
      console.log("✅ Card registered!");
      console.log(`   Content Type: ${result.contentType}`);

      if (result.content?.type === "song") {
        const song = result.content.song;
        console.log(`   🎵 Song: ${song.title}`);
        if (song.artist) console.log(`      Artist: ${song.artist}`);
        if (song.album) console.log(`      Album: ${song.album}`);
        console.log(`      Stream URL: ${serverUrl}/api/stream/${song.id}`);
      } else if (result.content?.type === "playlist") {
        const playlist = result.content.playlist;
        console.log(`   📂 Playlist: ${playlist.name}`);
        console.log(`      Songs: ${playlist.songs.length}`);
        playlist.songs.forEach((song, idx) => {
          console.log(
            `      ${idx + 1}. ${song.title}${song.artist ? ` - ${song.artist}` : ""}`
          );
        });
      } else if (result.content?.type === "action") {
        console.log(`   ⚡ Action: ${result.content.action.toUpperCase()}`);
      }
    } else if (response.status === 422 && "error" in result) {
      console.log("❌ Card not registered");
      console.log(`   Card ID: ${result.nfcId || cardId}`);
      console.log(`   Register it at: ${serverUrl}/cards`);
    } else {
      const errorMsg = "error" in result ? result.error : "Unknown error";
      console.error("❌ Failed to scan card");
      console.error(`   Status: ${response.status}`);
      console.error(`   Error: ${errorMsg}`);
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Network error:", error);
    console.error(`   Make sure the server is running at ${serverUrl}`);
    process.exit(1);
  }
}

// Parse command line arguments
const nfcId = process.argv[2];

// Run the simulation
simulateNFCScan(nfcId);
