/**
 * PlayerCore - Core business logic for the MusicBox player
 *
 * Manages:
 * - Player state (current song, playlist, playback status)
 * - Playback operations (play, pause, next, previous, stop)
 * - Card scanning and content handling
 * - Playlist queue and auto-advance
 */

import type { Action } from "shared";
import { AudioEngine } from "../audio/AudioEngine.ts";
import { ServerClient } from "../api/ServerClient.ts";
import type { PlayerState, PlayerStatus, SongInfo } from "./types.ts";

export class PlayerCore {
  private state: PlayerState;
  private audioEngine: AudioEngine;
  private serverClient: ServerClient;

  constructor(serverClient: ServerClient, audioEngine?: AudioEngine) {
    this.serverClient = serverClient;
    this.audioEngine = audioEngine || new AudioEngine();
    this.state = this.initialState();

    // Setup audio completion handler for auto-advance
    this.audioEngine.onComplete(() => this.handleAudioComplete());
  }

  /**
   * Initialize the player and play startup chime
   */
  async initialize(): Promise<void> {
    await this.audioEngine.playStartupChime();
    console.log("🎵 Player ready!");
  }

  private initialState(): PlayerState {
    return {
      currentSong: null,
      playlist: [],
      playlistIndex: 0,
      isPlaying: false,
    };
  }

  /**
   * Handle an NFC card scan
   * @param nfcId - The NFC card ID that was scanned
   */
  async handleCardScan(nfcId: string): Promise<void> {
    try {
      console.log(`\n🔍 Scanning card: ${nfcId}`);

      const result = await this.serverClient.scanCard(nfcId);

      if (result.content?.type === "song") {
        const song = result.content.song;
        console.log(`🎵 Playing song: ${song.title}`);
        if (song.artist) console.log(`   Artist: ${song.artist}`);
        if (song.album) console.log(`   Album: ${song.album}`);

        this.loadSong(song);
      } else if (result.content?.type === "playlist") {
        const playlist = result.content.playlist;
        console.log(`📂 Loading playlist: ${playlist.name}`);
        console.log(`   Songs: ${playlist.songs.length}`);

        this.loadPlaylist(playlist);
      } else if (result.content?.type === "action") {
        const action = result.content.action;
        console.log(`⚡ Action: ${action.toUpperCase()}`);
        this.executeAction(action);
      }
    } catch (error) {
      // Error already logged by ServerClient
    }
  }

  /**
   * Load and play a single song
   */
  private loadSong(song: {
    id: number;
    title: string;
    artist?: string | null;
    album?: string | null;
  }): void {
    this.state.currentSong = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      streamUrl: this.serverClient.getStreamUrl(song.id),
    };
    this.state.playlist = [];
    this.state.playlistIndex = 0;
    this.state.isPlaying = true;

    this.audioEngine.play(this.state.currentSong.streamUrl, {
      title: this.state.currentSong.title,
      artist: this.state.currentSong.artist,
    });
  }

  /**
   * Load and play a playlist
   */
  private loadPlaylist(playlist: {
    name: string;
    songs: Array<{
      id: number;
      title: string;
      artist?: string | null;
    }>;
  }): void {
    this.state.playlist = playlist.songs.map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      streamUrl: this.serverClient.getStreamUrl(song.id),
    }));
    this.state.playlistIndex = 0;

    if (this.state.playlist.length > 0) {
      const firstSong = this.state.playlist[0];
      this.state.currentSong = firstSong;
      this.state.isPlaying = true;

      console.log(`   ▶️  Playing: ${firstSong.title}`);
      if (firstSong.artist) console.log(`      ${firstSong.artist}`);

      this.audioEngine.play(firstSong.streamUrl, {
        title: firstSong.title,
        artist: firstSong.artist,
      });
    }
  }

  /**
   * Execute an action command
   */
  private executeAction(action: Action): void {
    switch (action) {
      case "play":
        this.play();
        break;
      case "pause":
        this.pause();
        break;
      case "next":
        this.next();
        break;
      case "previous":
        this.previous();
        break;
      case "stop":
        this.stop();
        break;
    }
  }

  /**
   * Play or resume playback
   */
  play(): void {
    // If paused, just resume
    if (this.state.currentSong && this.audioEngine.isPausedState()) {
      this.state.isPlaying = true;
      this.audioEngine.resume();
      console.log(`   ▶️  Resumed: ${this.state.currentSong.title}`);
    } else if (this.state.currentSong && !this.state.isPlaying) {
      // Start fresh playback
      this.state.isPlaying = true;
      console.log(`   ▶️  Playing: ${this.state.currentSong.title}`);
      this.audioEngine.play(this.state.currentSong.streamUrl, {
        title: this.state.currentSong.title,
        artist: this.state.currentSong.artist,
      });
    } else if (this.state.isPlaying) {
      console.log(`   ⚠️  Already playing`);
    } else {
      console.log(`   ⚠️  No song to play`);
    }
  }

  /**
   * Pause playback (keeps position)
   */
  pause(): void {
    if (this.state.isPlaying) {
      this.state.isPlaying = false;
      this.audioEngine.pause();
      console.log(`   ⏸️  Paused`);
    }
  }

  /**
   * Skip to next song in playlist
   */
  next(): void {
    if (this.state.playlist.length > 0) {
      this.state.playlistIndex =
        (this.state.playlistIndex + 1) % this.state.playlist.length;
      const nextSong = this.state.playlist[this.state.playlistIndex];
      this.state.currentSong = nextSong;
      this.state.isPlaying = true;
      console.log(`   ⏭️  Next: ${nextSong.title}`);
      this.audioEngine.play(nextSong.streamUrl, {
        title: nextSong.title,
        artist: nextSong.artist,
      });
    } else {
      console.log(`   ⚠️  No playlist loaded`);
    }
  }

  /**
   * Go to previous song in playlist
   */
  previous(): void {
    if (this.state.playlist.length > 0) {
      this.state.playlistIndex =
        (this.state.playlistIndex - 1 + this.state.playlist.length) %
        this.state.playlist.length;
      const prevSong = this.state.playlist[this.state.playlistIndex];
      this.state.currentSong = prevSong;
      this.state.isPlaying = true;
      console.log(`   ⏮️  Previous: ${prevSong.title}`);
      this.audioEngine.play(prevSong.streamUrl, {
        title: prevSong.title,
        artist: prevSong.artist,
      });
    } else {
      console.log(`   ⚠️  No playlist loaded`);
    }
  }

  /**
   * Stop playback and clear state
   */
  stop(): void {
    this.state.isPlaying = false;
    this.audioEngine.stop();
    this.state.currentSong = null;
    this.state.playlist = [];
    this.state.playlistIndex = 0;
    console.log(`   ⏹️  Stopped`);
  }

  /**
   * Get current player status
   */
  getStatus(): PlayerStatus {
    return {
      currentSong: this.state.currentSong,
      isPlaying: this.state.isPlaying,
      playlistPosition:
        this.state.playlist.length > 0
          ? `${this.state.playlistIndex + 1}/${this.state.playlist.length}`
          : null,
    };
  }

  /**
   * Handle audio playback completion (auto-advance)
   */
  private handleAudioComplete(): void {
    // Auto-play next song in playlist
    if (this.state.playlist.length > 0) {
      const nextIndex =
        (this.state.playlistIndex + 1) % this.state.playlist.length;
      if (nextIndex > this.state.playlistIndex) {
        this.state.playlistIndex = nextIndex;
        const nextSong = this.state.playlist[nextIndex];
        this.state.currentSong = nextSong;
        console.log(`\n⏭️  Auto-playing next: ${nextSong.title}`);
        this.audioEngine.play(nextSong.streamUrl, {
          title: nextSong.title,
          artist: nextSong.artist,
        });
      }
    }
  }

  /**
   * Set volume level
   * @param percent - Volume level 0-100
   */
  setVolume(percent: number): void {
    this.audioEngine.setVolume(percent);
  }

  /**
   * Get current volume level
   * @returns Volume percentage 0-100
   */
  getVolume(): number {
    return this.audioEngine.getVolume();
  }

  /**
   * Increase volume
   * @param amount - Amount to increase (default: 10)
   */
  volumeUp(amount?: number): void {
    this.audioEngine.volumeUp(amount);
  }

  /**
   * Decrease volume
   * @param amount - Amount to decrease (default: 10)
   */
  volumeDown(amount?: number): void {
    this.audioEngine.volumeDown(amount);
  }
}
