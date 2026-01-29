# MusicBox Project Instructions

## Context Files

When working on this project, read the following files into context:

- `docs/ESP32-BUILD-GUIDE.md` - Step-by-step guide for building the ESP32 player
- `docs/BUILD-GUIDE-TODOS.md` - Progress tracker for the build guide

## Project Structure

- `packages/esp32/` - ESP32 PlatformIO project for the hardware player
- `packages/api/` - Hono API server with SQLite database

## Control Plane Design

When building the Control Plane (web UI), use the design from the existing prototype as reference. Add specific design details here as we get to Phase 8.

## Development Workflow

1. Follow the ESP32 Build Guide step-by-step
2. After completing and verifying each step, mark it as complete in `docs/BUILD-GUIDE-TODOS.md`
3. Commit the step with a message referencing the step number (e.g., "Step 1.1: ESP32 Hello World")

## Code Style

- Write C-style C++ as much as possible (prefer C idioms, simple structs, functions over classes)