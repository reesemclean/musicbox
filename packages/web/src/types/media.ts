import { z } from 'zod'

// Base media type enum
export const mediaTypeSchema = z.enum(['song', 'podcast', 'soundmachine'])
export type MediaType = z.infer<typeof mediaTypeSchema>

// Current metadata version - bump when schema changes
export const METADATA_VERSION = 1

// Type-specific metadata schemas
export const songMetadataSchema = z.object({
  v: z.literal(METADATA_VERSION).default(METADATA_VERSION),
  artist: z.string().optional(),
  album: z.string().optional(),
  trackNumber: z.number().optional(),
  year: z.number().optional(),
})

export const podcastMetadataSchema = z.object({
  v: z.literal(METADATA_VERSION).default(METADATA_VERSION),
  showName: z.string(),
  episodeNumber: z.number().optional(),
  publishedAt: z.string().datetime().optional(),
  description: z.string().optional(),
})

export const soundmachineMetadataSchema = z.object({
  v: z.literal(METADATA_VERSION).default(METADATA_VERSION),
  category: z.string().optional(), // e.g., "nature", "white noise", "ambient"
  looping: z.boolean().default(true),
  system: z.boolean().default(false), // true for pre-bundled sounds
})

// Union metadata based on type
export const metadataSchema = z.union([
  songMetadataSchema,
  podcastMetadataSchema,
  soundmachineMetadataSchema,
])

// Typed metadata by media type
export type SongMetadata = z.infer<typeof songMetadataSchema>
export type PodcastMetadata = z.infer<typeof podcastMetadataSchema>
export type SoundmachineMetadata = z.infer<typeof soundmachineMetadataSchema>

// Helper to get correct schema based on type
export function getMetadataSchema(type: MediaType) {
  switch (type) {
    case 'song':
      return songMetadataSchema
    case 'podcast':
      return podcastMetadataSchema
    case 'soundmachine':
      return soundmachineMetadataSchema
  }
}

// Validate and parse metadata before DB insert
export function validateMetadata(type: MediaType, data: unknown) {
  const schema = getMetadataSchema(type)
  return schema.parse(data)
}

// Safe parse that returns result object
export function safeValidateMetadata(type: MediaType, data: unknown) {
  const schema = getMetadataSchema(type)
  return schema.safeParse(data)
}

// Full media item schemas for API input validation
export const createMediaSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('song'),
    title: z.string().min(1),
    duration: z.number().optional(),
    mimeType: z.string().optional(),
    metadata: songMetadataSchema.optional(),
  }),
  z.object({
    type: z.literal('podcast'),
    title: z.string().min(1),
    duration: z.number().optional(),
    mimeType: z.string().optional(),
    metadata: podcastMetadataSchema,
  }),
  z.object({
    type: z.literal('soundmachine'),
    title: z.string().min(1),
    duration: z.number().optional(),
    mimeType: z.string().optional(),
    metadata: soundmachineMetadataSchema.optional(),
  }),
])

export type CreateMediaInput = z.infer<typeof createMediaSchema>
