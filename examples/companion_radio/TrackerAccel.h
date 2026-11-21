#pragma once

/*
 * Motion sensing for tracker mode: QMA6100P accelerometer of the T1000-E (I2C, polled).
 *
 * Reads the sensor every TRK_MOT_SAMPLE_MS and hands the samples to TrackerMotion (TrackerMotion.h):
 * motion and activity (trk7), impact / fall, time without motion and posture (trk10).
 * It never makes the tracker report less often, so a dead or stuck sensor cannot hide a moving dog:
 * without the sensor (or with trk_acc=0) the tracker behaves exactly as before (GPS only).
 */

#include <Arduino.h>
#include "TrackerMotion.h"

#if defined(TRACKER_MODE) && defined(HAS_QMA6100P)

#include <Wire.h>


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
    _m.reset(millis());
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
    _next = millis() + TRK_MOT_SAMPLE_MS;
    uint8_t b[6];
    if (!rd(0x01, b, 6)) {
      if (++_errors > 20) off();   // sensor gone: stop trying
      return;
    }
    _errors = 0;
    int16_t v[3];
    for (int i = 0; i < 3; i++) v[i] = ((int16_t)((b[2 * i + 1] << 8) | b[2 * i])) >> 2;
    _m.feed(v[0] / 2, v[1] / 2, v[2] / 2, millis());   // LSB -> mg (0.488)
  }

  bool movingNow() const { return _ok && _m.movingNow(); }
  int activity() const { return _ok ? _m.activity() : -1; }
  void resetStats() { _m.resetStats(); }
  unsigned long stillMs() const { return _ok ? _m.stillMs(millis()) : 0; }
  TrkImpact takeImpact() { return _ok ? _m.takeImpact() : TRK_IMP_NONE; }
  TrkPosture posture() const { return _ok ? _m.posture() : TRK_POS_UNKNOWN; }

private:
  bool _ok = false;
  uint8_t _addr = 0x12, _errors = 0;
  unsigned long _next = 0;
  TrackerMotion _m;

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
  unsigned long stillMs() const { return 0; }
  TrkImpact takeImpact() { return TRK_IMP_NONE; }
  TrkPosture posture() const { return TRK_POS_UNKNOWN; }
};

#endif
