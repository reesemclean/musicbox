# MusicBox Hardware Wiring Guide

Complete wiring diagram for Raspberry Pi Zero 2 W with NFC reader, I2S amplifier, and control buttons.

## Components

- **Raspberry Pi Zero 2 W** (also compatible with Pi 3/4)
- **PN532 NFC/RFID Reader** (I2C mode)
- **MAX98357A I2S Amplifier**
- **5x Momentary Push Buttons** (normally open)
- **Speaker** (4Ω to 8Ω, 3W)

## Power Connections

### 5V Power Rail

- Pin 2 (5V) → PN532 VCC
- Pin 4 (5V) → MAX98357A VIN

### Ground Rail

- Pin 6 (GND) → PN532 GND
- Pin 9 (GND) → MAX98357A GND
- Pin 14 (GND) → All button common ground

**Note:** Use Pin 14 (GND) as a common ground bus for all 5 buttons. You can use a breadboard rail or wire them together.

## I2C Bus (NFC Reader)

**PN532 in I2C Mode:**

- GPIO 2 (Pin 3) → SDA
- GPIO 3 (Pin 5) → SCL
- GPIO 17 (Pin 11) → RQ/IRQ (interrupt for card detection)
- 5V (Pin 2) → VCC
- GND (Pin 6) → GND

**Note:** The RQ/IRQ pin enables interrupt-based card detection. Without it, the player must poll for cards. With it connected, the PN532 signals when a card is present, reducing CPU usage to near zero.

**PN532 Mode Selection:**
Set DIP switches or jumpers for I2C mode (consult your module's documentation).

## I2S Audio (MAX98357A)

**Digital Audio Interface:**

- GPIO 18 (Pin 12) → BCLK (Bit Clock)
- GPIO 19 (Pin 35) → LRC (Left/Right Clock / Word Select)
- GPIO 21 (Pin 40) → DIN (Data In)

**Power:**

- 5V (Pin 4) → VIN
- GND (Pin 9) → GND

**Speaker Output:**

- MAX98357A + → Speaker +
- MAX98357A - → Speaker -

**Gain Control:**

- GAIN → Leave floating (unconnected) for 9dB gain (recommended)

**Shutdown Pin (SD):**

- SD → Leave floating (unconnected) - amplifier always enabled

## Control Buttons

All buttons connect between GPIO pin and GND (active-low with internal pull-ups).

**Wiring:** Each button connects one side to the GPIO pin below, other side to common ground (Pin 14).

- GPIO 5 (Pin 29) + GND (Pin 14) → **Play/Pause Button**
- GPIO 6 (Pin 31) + GND (Pin 14) → **Volume Up Button**
- GPIO 13 (Pin 33) + GND (Pin 14) → **Volume Down Button**
- GPIO 16 (Pin 36) + GND (Pin 14) → **Next Track Button**
- GPIO 26 (Pin 37) + GND (Pin 14) → **Previous Track Button**

**No external pull-up resistors needed** - software enables internal pull-ups.

## Pin Reference Table

| Pin # | GPIO | Function  | Connected To            |
| ----- | ---- | --------- | ----------------------- |
| 2     | 5V   | Power     | PN532 VCC               |
| 3     | 2    | I2C SDA   | PN532 SDA               |
| 4     | 5V   | Power     | MAX98357A VIN           |
| 5     | 3    | I2C SCL   | PN532 SCL               |
| 6     | GND  | Ground    | PN532 GND               |
| 9     | GND  | Ground    | MAX98357A GND           |
| 11    | 17   | NFC IRQ   | PN532 RQ/IRQ            |
| 12    | 18   | I2S BCLK  | MAX98357A BCLK          |
| 14    | GND  | Ground    | All buttons common      |
| 29    | 5    | GPIO      | Play/Pause button       |
| 31    | 6    | GPIO      | Volume Up button        |
| 33    | 13   | GPIO      | Volume Down button      |
| 35    | 19   | I2S LRC   | MAX98357A LRC           |
| 36    | 16   | GPIO      | Next Track button       |
| 37    | 26   | GPIO      | Previous Track button   |
| 40    | 21   | I2S DIN   | MAX98357A DIN           |

## GPIO Usage Summary

**Reserved for Hardware Interfaces:**

- GPIO 2, 3: I2C (NFC reader)
- GPIO 17: NFC IRQ (interrupt from PN532)
- GPIO 18, 19, 21: I2S audio (MAX98357A)

**Button Inputs:**

- GPIO 5, 6, 13, 16, 26: Control buttons

**Available for Future Use:**

- GPIO 4, 27, 23, 24, 25, and others (see Pi pinout)

## Circuit Diagram

```
Raspberry Pi
┌─────────────────────────────────────────┐
│                                         │
│  5V (2) ──────┬─────────────── PN532   │
│               └─────────────── MAX98357A│
│                                         │
│  GPIO 2 (3) ──────────────── PN532 SDA │
│  GPIO 3 (5) ──────────────── PN532 SCL │
│  GPIO 17 (11) ─────────────── PN532 RQ │
│                                         │
│  GPIO 18 (12) ─────────── MAX98357A BCLK│
│  GPIO 19 (35) ─────────── MAX98357A LRC │
│  GPIO 21 (40) ─────────── MAX98357A DIN │
│                                         │
│  GPIO 5 (29) ──[Button]──┐             │
│  GPIO 6 (31) ──[Button]──┤             │
│  GPIO 13 (33) ─[Button]──┼── GND (14)  │
│  GPIO 16 (36) ─[Button]──┤             │
│  GPIO 26 (37) ─[Button]──┘             │
│                                         │
│  GND (6) ──────────────────── PN532    │
│  GND (9) ──────────────────── MAX98357A│
│  GND (14) ─────────────────── Buttons  │
│                                         │
└─────────────────────────────────────────┘

MAX98357A ──[Speaker]── (4-8Ω, 3W)
```

## Software Configuration

All hardware is automatically configured by the NixOS image:

- **I2C:** Enabled with `/dev/i2c-1` accessible to musicbox user
- **I2S:** Device tree overlay configured for HiFiBerry DAC compatible mode
- **GPIO:** Accessible via sysfs (`/sys/class/gpio`)
- **Audio:** PipeWire with ALSA, default output to MAX98357A

## Testing Hardware

After flashing the image and booting:

### Test I2C (NFC Reader)

```bash
ssh root@musicbox-test-player.local
i2cdetect -y 1
# Should show device at address 0x24
```

### Test Audio Output

```bash
speaker-test -t wav -c 2
# Should play test sound through MAX98357A
```

### Test GPIO (Buttons)

```bash
# Watch for button press events in logs
journalctl -u musicbox-player -f
# Press buttons and verify actions
```

### Test Volume Control

```bash
# Via HTTP API
curl -X POST http://musicbox-test-player.local:8080/volume -d '{"level": 50}'
```

## Troubleshooting

**NFC reader not detected:**

- Check I2C connections (SDA/SCL not swapped)
- Verify PN532 is in I2C mode (check DIP switches)
- Run `i2cdetect -y 1` to scan for devices

**No audio output:**

- Check I2S connections (BCLK, LRC, DIN)
- Verify MAX98357A power (VIN = 5V)
- Run `aplay -l` to list audio devices
- Check speaker connections (not shorted)

**Buttons not working:**

- Verify GPIO connections
- Check button wiring (one side to GPIO, other to GND)
- Buttons should be normally-open (not normally-closed)
- Check logs: `journalctl -u musicbox-player -f`

## Safety Notes

- **Speaker Impedance:** Use 4Ω to 8Ω speakers only (MAX98357A max 3W)
- **Volume Limits:** Start at low volume (10% default) to avoid speaker damage
- **Power Supply:** Use adequate 5V 3A power supply for Pi 4 with peripherals
- **Static Protection:** Touch grounded metal before handling components
- **No Hot-Plugging:** Always power off before connecting/disconnecting hardware

## Bill of Materials

| Component             | Specification  | Quantity |
| --------------------- | -------------- | -------- |
| Raspberry Pi 4        | Any RAM size   | 1        |
| PN532 NFC Module      | I2C capable    | 1        |
| MAX98357A Breakout    | I2S amplifier  | 1        |
| Speaker               | 4-8Ω, 3W       | 1        |
| Push Buttons          | Momentary, NO  | 5        |
| MicroSD Card          | 8GB+ Class 10  | 1        |
| Power Supply          | 5V 3A USB-C    | 1        |
| Jumper Wires          | Male-Female    | ~20      |
| Breadboard (optional) | Half/Full size | 1        |

## Assembly Tips

1. **Use a breadboard** for prototyping before permanent wiring
2. **Color code wires:** Red (5V), Black (GND), other colors for signals
3. **Double-check polarity** before powering on
4. **Test incrementally:** Add one component at a time
5. **Label everything:** Use tape/labels on wires for easy debugging

## Next Steps

- [CUSTOM-IMAGE.md](CUSTOM-IMAGE.md) - Build and flash the SD card image
- [PI-SETUP.md](PI-SETUP.md) - Boot and configure the Pi
- [DEPLOYMENT.md](../DEPLOYMENT.md) - Production deployment guide
