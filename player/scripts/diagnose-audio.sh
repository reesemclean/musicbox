#!/usr/bin/env bash
# MusicBox Player - Audio Diagnostics
#
# Run this script on your Raspberry Pi to diagnose MAX98357A audio issues
#
# Usage:
#   ./diagnose-audio.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║       MusicBox Player - MAX98357A Audio Diagnostics           ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# ============================================================================
# 1. Check I2S Device Tree Overlay
# ============================================================================

log_info "Checking I2S device tree configuration..."

if command -v dtoverlay &> /dev/null; then
    if dtoverlay -l | grep -iE "(i2s|hifiberry|googlevoice)" > /dev/null; then
        log_success "I2S device tree overlay is loaded"
        dtoverlay -l | grep -iE "(i2s|hifiberry|googlevoice)"
    else
        log_error "I2S device tree overlay NOT loaded!"
        echo "  Expected: i2s-max98357a, hifiberry-dac, or googlevoicehat-soundcard"
        echo "  Fix: Update your NixOS configuration with I2S overlay"
    fi
else
    log_warning "dtoverlay command not found (might be normal on NixOS)"
fi

echo ""

# ============================================================================
# 2. Check Audio Cards
# ============================================================================

log_info "Checking audio cards..."

if command -v aplay &> /dev/null; then
    if aplay -l > /dev/null 2>&1; then
        aplay -l

        # Check for I2S card specifically
        if aplay -l | grep -iE "(sndrpihifiberry|MAX98357A|simple-card)" > /dev/null; then
            log_success "I2S audio card detected!"
        else
            log_warning "Only seeing bcm2835 (HDMI/headphone) - I2S card not detected"
            echo "  This means the MAX98357A is not recognized by the system"
        fi
    else
        log_error "No sound cards found!"
    fi
else
    log_error "aplay not installed!"
fi

echo ""

# ============================================================================
# 3. Check /proc/asound
# ============================================================================

log_info "Checking /proc/asound/cards..."

if [ -f /proc/asound/cards ]; then
    cat /proc/asound/cards

    if grep -iE "(sndrpihifiberry|MAX98357A|simple-card)" /proc/asound/cards > /dev/null; then
        log_success "I2S card registered in ALSA"
    else
        log_warning "I2S card not in /proc/asound/cards"
    fi
else
    log_error "/proc/asound/cards not found!"
fi

echo ""

# ============================================================================
# 4. Check ALSA Configuration
# ============================================================================

log_info "Checking ALSA configuration..."

if [ -f /etc/asound.conf ]; then
    log_success "ALSA config exists at /etc/asound.conf"
    echo "  Content:"
    sed 's/^/    /' /etc/asound.conf
else
    log_warning "No /etc/asound.conf found (using defaults)"
fi

echo ""

# ============================================================================
# 5. Check PipeWire/PulseAudio
# ============================================================================

log_info "Checking audio server..."

if systemctl is-active --quiet pipewire; then
    log_success "PipeWire is running"

    if command -v pactl &> /dev/null; then
        log_info "Listing PipeWire sinks..."
        pactl list sinks short 2>/dev/null || log_warning "pactl failed (might need user context)"
    else
        log_warning "pactl not found - volume control limited"
    fi
elif systemctl is-active --quiet pulseaudio; then
    log_success "PulseAudio is running"
else
    log_error "No audio server (PipeWire/PulseAudio) running!"
fi

echo ""

# ============================================================================
# 6. Check GPIO Access (for amplifier shutdown control)
# ============================================================================

log_info "Checking GPIO access for MAX98357A shutdown pin (GPIO 22)..."

if [ -e /dev/gpiochip0 ]; then
    log_success "/dev/gpiochip0 exists"

    if command -v gpioget &> /dev/null; then
        if gpioget gpiochip0 22 &> /dev/null; then
            STATE=$(gpioget gpiochip0 22)
            log_success "GPIO 22 accessible (current state: $STATE)"
            echo "  0 = Amplifier OFF (shutdown)"
            echo "  1 = Amplifier ON (active)"
        else
            log_error "GPIO 22 not accessible (permission denied?)"
            echo "  Check that user is in 'gpio' group"
        fi
    else
        log_warning "gpioget not found - can't test GPIO"
    fi
else
    log_error "/dev/gpiochip0 not found!"
fi

echo ""

# ============================================================================
# 7. Check I2S Kernel Modules
# ============================================================================

log_info "Checking I2S kernel modules..."

if lsmod | grep -E "snd_soc|i2s" > /dev/null; then
    log_success "I2S/ASoC kernel modules loaded:"
    lsmod | grep -E "snd_soc|i2s"
else
    log_warning "No I2S kernel modules detected"
fi

echo ""

# ============================================================================
# 8. Check MusicBox Player Service
# ============================================================================

log_info "Checking MusicBox Player service..."

if systemctl is-active --quiet musicbox-player; then
    log_success "musicbox-player service is running"

    log_info "Recent logs (last 20 lines):"
    journalctl -u musicbox-player -n 20 --no-pager | sed 's/^/    /'
else
    log_error "musicbox-player service is NOT running!"
    echo "  Start with: sudo systemctl start musicbox-player"
    echo "  Check logs: sudo journalctl -u musicbox-player"
fi

echo ""

# ============================================================================
# 9. Test Audio Output (Optional)
# ============================================================================

log_info "Audio output test..."

echo "  Would you like to test audio output? (y/N)"
read -r -p "  > " response

if [[ "$response" =~ ^[Yy]$ ]]; then
    if command -v speaker-test &> /dev/null; then
        log_info "Playing test tone for 3 seconds..."
        echo "  You should hear a tone from your speaker"
        timeout 3 speaker-test -t sine -f 1000 -c 2 || log_warning "Test failed"
    else
        log_warning "speaker-test not available"

        if command -v ffplay &> /dev/null; then
            log_info "Testing with ffplay silence..."
            echo "  ffplay should run without errors (no sound expected)"
            timeout 2 ffplay -nodisp -autoexit -f lavfi -i "sine=frequency=1000:duration=2" 2>&1 | head -5
        else
            log_warning "No audio test tools available"
        fi
    fi
fi

echo ""

# ============================================================================
# Summary
# ============================================================================

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                        SUMMARY                                 ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

log_info "Quick checklist:"
echo ""
echo "  [ ] I2S device tree overlay loaded"
echo "  [ ] I2S audio card detected (not just bcm2835)"
echo "  [ ] PipeWire/PulseAudio running"
echo "  [ ] GPIO 22 accessible"
echo "  [ ] musicbox-player service running"
echo "  [ ] Audio test produces sound"
echo ""

log_info "Common fixes:"
echo ""
echo "  1. No I2S card detected:"
echo "     → Update NixOS config with I2S device tree overlay"
echo "     → Rebuild: sudo nixos-rebuild switch"
echo "     → Reboot to load device tree changes"
echo ""
echo "  2. GPIO permission denied:"
echo "     → Ensure user in 'gpio' group: sudo usermod -a -G gpio musicbox"
echo "     → Restart service: sudo systemctl restart musicbox-player"
echo ""
echo "  3. No audio output:"
echo "     → Check speaker wiring (GPIO 18/19/21 for I2S, GPIO 22 for SD)"
echo "     → Test with: speaker-test -t sine -f 1000"
echo "     → Check logs: sudo journalctl -u musicbox-player -f"
echo ""
echo "  4. Volume control not working:"
echo "     → MAX98357A has no software volume - uses GAIN pin"
echo "     → Connect GAIN to GND (9dB) or leave floating (15dB)"
echo "     → Or use ffplay volume filter (fallback in code)"
echo ""

log_info "For more help, see: docs/MAX98357A-AUDIO-FIX.md"
