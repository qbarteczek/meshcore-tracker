#pragma once

/*
 * Motion sensing for tracker mode: QMA6100P accelerometer of the T1000-E (I2C, polled).
 *
 * Used for two things only:
 *   - waking the tracker early when it starts moving after standing still,
 *   - an activity figure (0..99) in the report, to tell walking from running or resting.
 * It never makes the tracker report less often, so a dead or stuck sensor cannot hide a moving dog:
 * without the sensor (or with trk_acc=0) the tracker behaves exactly as before (GPS only).
 */

#include <Arduino.h>

#if defined(TRACKER_MODE) && defined(HAS_QMA6100P)

#include <Wire.h>

#define TRK_ACC_SAMPLE_MS     250UL   // 4 Hz
#define TRK_ACC_MOTION_MG     70      // change between two samples (sum of 3 axes) that counts as motion
#define TRK_ACC_RUN_MAX       16
#define TRK_ACC_RUN_SUSTAINED 8       // net 2 s of motion = "moving now"

class TrackerAccel {
public:
  // powers the sensor and checks its ID; false = no sensor answering
  bool begin() {
    _ok = false;
#ifdef PIN_3V3_ACC_EN
    pinMode(PIN_3V3_ACC_EN, OUTPUT);
    digitalWrite(PIN_3V3_ACC_EN, HIGH);
    delay(20);
#endif
    static const uint8_t addrs[] = {0x12, 0x13};
    for (uint8_t i = 0; i < sizeof(addrs) && !_ok; i++) {
      _addr = addrs[i];
      uint8_t id = 0;
      if (rd(0x00, &id, 1) && id == 0x90) _ok = true;
    }
    if (!_ok) { off(); return false; }
    wr(0x36, 0xB6); delay(5);     // soft reset
    wr(0x36, 0x00); delay(10);
    wr(0x11, 0x80);               // active mode
    wr(0x11, 0x84);
    wr(0x4A, 0x20);
    wr(0x56, 0x01);
    wr(0x5F, 0x80); delay(2);
    wr(0x5F, 0x00); delay(10);
    wr(0x0F, 0x02);               // +-4 g: 0.488 mg per LSB (14 bit)
    wr(0x11, 0x84);
    _have_prev = false;
    _run = 0;
    resetStats();
    _next = millis();
    return true;
  }

  void off() {
    _ok = false;
#ifdef PIN_3V3_ACC_EN
    digitalWrite(PIN_3V3_ACC_EN, LOW);
#endif
  }

  bool ok() const { return _ok; }

  // call as often as you like; reads the sensor every TRK_ACC_SAMPLE_MS
  void poll() {
    if (!_ok || (long)(millis() - _next) < 0) return;
    _next = millis() + TRK_ACC_SAMPLE_MS;
    uint8_t b[6];
    if (!rd(0x01, b, 6)) {
      if (++_errors > 20) off();   // sensor gone: stop trying
      return;
    }
    _errors = 0;
    int16_t v[3];
    for (int i = 0; i < 3; i++) v[i] = ((int16_t)((b[2 * i + 1] << 8) | b[2 * i])) >> 2;
    if (_have_prev) {
      long d = 0;
      for (int i = 0; i < 3; i++) d += abs(v[i] - _prev[i]);
      d = d / 2;                    // LSB -> mg (0.488)
      _sum += d;
      _n++;
      if (d > TRK_ACC_MOTION_MG) { if (_run < TRK_ACC_RUN_MAX) _run++; }
      else if (_run > 0) _run--;
    }
    for (int i = 0; i < 3; i++) _prev[i] = v[i];
    _have_prev = true;
  }

  bool movingNow() const { return _ok && _run >= TRK_ACC_RUN_SUSTAINED; }

  // mean change between samples since resetStats(), in units of 10 mg, 0..99 (-1 = no data)
  int activity() const {
    if (!_ok || _n == 0) return -1;
    long a = _sum / (long)_n / 10;
    return a > 99 ? 99 : (int)a;
  }

  void resetStats() { _sum = 0; _n = 0; }

private:
  bool _ok = false, _have_prev = false;
  uint8_t _addr = 0x12, _run = 0, _errors = 0;
  int16_t _prev[3] = {0, 0, 0};
  unsigned long _next = 0;
  long _sum = 0;
  uint32_t _n = 0;

  bool wr(uint8_t reg, uint8_t val) {
    Wire.beginTransmission(_addr);
    Wire.write(reg);
    Wire.write(val);
    return Wire.endTransmission() == 0;
  }
  bool rd(uint8_t reg, uint8_t* dest, uint8_t n) {
    Wire.beginTransmission(_addr);
    Wire.write(reg);
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(_addr, n) != n) return false;
    for (uint8_t i = 0; i < n; i++) dest[i] = Wire.read();
    return true;
  }
};

#else

// no accelerometer on this board: same interface, never reports motion
class TrackerAccel {
public:
  bool begin() { return false; }
  void off() { }
  bool ok() const { return false; }
  void poll() { }
  bool movingNow() const { return false; }
  int activity() const { return -1; }
  void resetStats() { }
};

#endif
