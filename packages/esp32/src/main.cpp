#include <Arduino.h>
#include <Button2.h>

// Button pins
#define BTN_PLAY   10
#define BTN_VOL_UP 11
#define BTN_VOL_DN 12
#define BTN_NEXT   13
#define BTN_PREV   14

Button2 btnPlay, btnVolUp, btnVolDn, btnNext, btnPrev;

void onPlayClick(Button2 &btn) {
    Serial.println("Play/Pause: click");
}

void onPlayLongPress(Button2 &btn) {
    Serial.println("Play/Pause: LONG PRESS");
}

void onVolUpClick(Button2 &btn) {
    Serial.println("Volume Up: click");
}

void onVolDnClick(Button2 &btn) {
    Serial.println("Volume Down: click");
}

void onNextClick(Button2 &btn) {
    Serial.println("Next: click");
}

void onPrevClick(Button2 &btn) {
    Serial.println("Prev: click");
}

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("MusicBox ESP32 Starting...");
    Serial.println("Button test - press any button");

    // Initialize buttons (active low with internal pull-up)
    btnPlay.begin(BTN_PLAY, INPUT_PULLUP, true);
    btnVolUp.begin(BTN_VOL_UP, INPUT_PULLUP, true);
    btnVolDn.begin(BTN_VOL_DN, INPUT_PULLUP, true);
    btnNext.begin(BTN_NEXT, INPUT_PULLUP, true);
    btnPrev.begin(BTN_PREV, INPUT_PULLUP, true);

    // Play button: click and long press (3 seconds, triggers immediately)
    btnPlay.setClickHandler(onPlayClick);
    btnPlay.setLongClickTime(3000);
    btnPlay.setLongClickDetectedHandler(onPlayLongPress);

    // Other buttons: click only
    btnVolUp.setClickHandler(onVolUpClick);
    btnVolDn.setClickHandler(onVolDnClick);
    btnNext.setClickHandler(onNextClick);
    btnPrev.setClickHandler(onPrevClick);
}

void loop() {
    btnPlay.loop();
    btnVolUp.loop();
    btnVolDn.loop();
    btnNext.loop();
    btnPrev.loop();
}
