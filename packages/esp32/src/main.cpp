#include <Arduino.h>
#include <driver/i2s.h>
#include <math.h>

// I2S pins for MAX98357A
#define I2S_BCLK 4
#define I2S_LRC  5
#define I2S_DOUT 6

#define SAMPLE_RATE 16000

static void i2s_init(void) {
    i2s_config_t i2s_config = {
        .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
        .sample_rate = SAMPLE_RATE,
        .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
        .channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT,
        .communication_format = I2S_COMM_FORMAT_STAND_I2S,
        .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
        .dma_buf_count = 8,
        .dma_buf_len = 64,
        .use_apll = false,
        .tx_desc_auto_clear = true,
        .fixed_mclk = 0
    };

    i2s_pin_config_t pin_config = {
        .bck_io_num = I2S_BCLK,
        .ws_io_num = I2S_LRC,
        .data_out_num = I2S_DOUT,
        .data_in_num = I2S_PIN_NO_CHANGE
    };

    esp_err_t err = i2s_driver_install(I2S_NUM_0, &i2s_config, 0, NULL);
    Serial.printf("I2S driver install: %s\n", esp_err_to_name(err));

    err = i2s_set_pin(I2S_NUM_0, &pin_config);
    Serial.printf("I2S set pin: %s\n", esp_err_to_name(err));
}

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("MusicBox ESP32 Starting...");

    // PSRAM check
    if (psramFound()) {
        Serial.printf("PSRAM: %d bytes\n", ESP.getPsramSize());
    } else {
        Serial.println("PSRAM: Not found");
    }

    // Initialize I2S
    Serial.println("Initializing I2S...");
    i2s_init();
    Serial.println("I2S initialized - playing continuous tone");
}

void loop() {
    // Generate 440Hz sine wave continuously
    static uint32_t sample_idx = 0;
    int16_t samples[64];
    size_t bytes_written;

    for (int i = 0; i < 32; i++) {
        float angle = 2.0f * M_PI * 440.0f * sample_idx / SAMPLE_RATE;
        int16_t sample = (int16_t)(sinf(angle) * 200);
        samples[i * 2] = sample;      // Left
        samples[i * 2 + 1] = sample;  // Right
        sample_idx++;
    }

    i2s_write(I2S_NUM_0, samples, sizeof(samples), &bytes_written, portMAX_DELAY);
}
