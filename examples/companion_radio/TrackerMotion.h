#pragma once

/*
 * Motion logic of tracker mode (trk10), separate from the sensor so it can be tested on a computer
 * (test/tracker_motion/test_motion.cpp). Fed with accelerometer samples (mg, every TRK_MOT_SAMPLE_MS):
 *
 *   - activity 0..99 and "moving now" (2 s of sustained motion), as in trk7: computed on every 5th sample
 *     (250 ms), so the figures keep their meaning,
 *   - impact: a jolt above TRK_MOT_IMPACT_MG; "fall" when free fall (|a| below TRK_MOT_FREEFALL_MG for
 *     TRK_MOT_FREEFALL_N samples) came just before it. Reported only when the dog then stays still for
 *     TRK_MOT_CONFIRM_MS: a dog that lands after a jump and runs on raises no alarm,
 *   - time since the last motion (for "still away from home"),
 *   - posture: the angle between gravity now and gravity while walking (learnt on the first walk, the
 *     tracker's mounting is unknown): upright (stands, or lies on its belly), side, back.
 */

#include <stdint.h>
#include <math.h>

#define TRK_MOT_SAMPLE_MS      50UL     // 20 Hz: impacts last tens of milliseconds
#define TRK_MOT_SUB            5        // motion / activity on every 5th sample = 250 ms (as trk7)
#define TRK_MOT_MOTION_MG      70       // change between two 250 ms samples that counts as motion
#define TRK_MOT_RUN_MAX        16
#define TRK_MOT_RUN_SUSTAINED  8        // net 2 s of motion = "moving now"
#define TRK_MOT_IMPACT_MG      3200     // jolt (the sensor is set to +-4 g)
#define TRK_MOT_FREEFALL_MG    350
#define TRK_MOT_FREEFALL_N     3        // 150 ms of free fall
#define TRK_MOT_FALL_WINDOW_MS 1000UL   // free fall at most this long before the impact = a fall
#define TRK_MOT_CONFIRM_MS     30000UL  // still this long after the impact = alarm
#define TRK_MOT_CONFIRM_MOVES  4        // allowed motion steps (250 ms) in the confirm window
#define TRK_MOT_EVENT_GAP_MS   600000UL // at most one impact alarm per 10 min
#define TRK_MOT_REF_N          120      // walking samples (250 ms) before the posture reference is trusted
#define TRK_MOT_SIDE_DEG       45.0f
#define TRK_MOT_BACK_DEG       135.0f

enum TrkPosture { TRK_POS_UNKNOWN = 0, TRK_POS_UPRIGHT, TRK_POS_SIDE, TRK_POS_BACK };
enum TrkImpact { TRK_IMP_NONE = 0, TRK_IMP_IMPACT, TRK_IMP_FALL };

class TrackerMotion {
public:
  void reset(unsigned long now) {
    _have_prev = false; _run = 0; _sum = 0; _n = 0; _sub = 0;
    _last_motion = now; _ff_count = 0; _ff_end = 0; _cand = TRK_IMP_NONE; _event = TRK_IMP_NONE;
    _last_event = 0; _have_event = false; _g_ok = false; _ref_n = 0;
  }

  // one sample in mg
  void feed(int x, int y, int z, unsigned long now) {
    // gravity: low pass (about 0.5 s)
    if (!_g_ok) { _gx = x; _gy = y; _gz = z; _g_ok = true; }
    else { _gx += (x - _gx) * 0.1f; _gy += (y - _gy) * 0.1f; _gz += (z - _gz) * 0.1f; }

    long mag = (long)sqrtf((float)x * x + (float)y * y + (float)z * z);
    if (mag < TRK_MOT_FREEFALL_MG) {
      if (++_ff_count >= TRK_MOT_FREEFALL_N) _ff_end = now;
    } else {
      _ff_count = 0;
    }
    if (mag >= TRK_MOT_IMPACT_MG && _cand == TRK_IMP_NONE
        && (!_have_event || now - _last_event >= TRK_MOT_EVENT_GAP_MS)) {
      _cand = (_ff_end && now - _ff_end <= TRK_MOT_FALL_WINDOW_MS) ? TRK_IMP_FALL : TRK_IMP_IMPACT;
      _cand_at = now;
      _cand_moves = 0;
      _cand_skip = TRK_MOT_SUB * 4;   // the jolt itself and its ringing are not "moving on"
    }

    if (++_sub < TRK_MOT_SUB) return;
    _sub = 0;
    // every 250 ms: motion, activity, posture reference
    if (_have_prev) {
      long d = labs(x - _px) + labs(y - _py) + labs(z - _pz);
      _sum += d; _n++;
      bool moved = d > TRK_MOT_MOTION_MG;
      if (moved) { _last_motion = now; if (_run < TRK_MOT_RUN_MAX) _run++; }
      else if (_run > 0) _run--;
      if (_cand != TRK_IMP_NONE) {
        if (_cand_skip > 0) _cand_skip -= TRK_MOT_SUB;
        else if (moved && ++_cand_moves > TRK_MOT_CONFIRM_MOVES) _cand = TRK_IMP_NONE;   // it ran on
      }
      if (movingNow()) learnUpright();
    }
    _px = x; _py = y; _pz = z; _have_prev = true;
    if (_cand != TRK_IMP_NONE && now - _cand_at >= TRK_MOT_CONFIRM_MS) {
      _event = _cand; _cand = TRK_IMP_NONE;
      _last_event = now; _have_event = true;
    }
  }

  bool movingNow() const { return _run >= TRK_MOT_RUN_SUSTAINED; }

  // mean change between 250 ms samples since resetStats(), in units of 10 mg, 0..99 (-1 = no data)
  int activity() const {
    if (_n == 0) return -1;
    long a = _sum / (long)_n / 10;
    return a > 99 ? 99 : (int)a;
  }
  void resetStats() { _sum = 0; _n = 0; }

  unsigned long stillMs(unsigned long now) const { return now - _last_motion; }

  // impact confirmed since the last call (once)
  TrkImpact takeImpact() { TrkImpact e = _event; _event = TRK_IMP_NONE; return e; }

  TrkPosture posture() const {
    if (_ref_n < TRK_MOT_REF_N || !_g_ok) return TRK_POS_UNKNOWN;
    float gl = sqrtf(_gx * _gx + _gy * _gy + _gz * _gz);
    float rl = sqrtf(_rx * _rx + _ry * _ry + _rz * _rz);
    if (gl < 300 || rl < 0.5f) return TRK_POS_UNKNOWN;   // free fall or no reference
    float c = (_gx * _rx + _gy * _ry + _gz * _rz) / (gl * rl);
    if (c > 1) c = 1;
    if (c < -1) c = -1;
    float deg = acosf(c) * 57.29578f;
    if (deg < TRK_MOT_SIDE_DEG) return TRK_POS_UPRIGHT;
    if (deg < TRK_MOT_BACK_DEG) return TRK_POS_SIDE;
    return TRK_POS_BACK;
  }

private:
  bool _have_prev = false, _g_ok = false, _have_event = false;
  int _px = 0, _py = 0, _pz = 0;
  uint8_t _run = 0, _sub = 0, _ff_count = 0;
  long _sum = 0;
  uint32_t _n = 0;
  unsigned long _last_motion = 0, _ff_end = 0, _cand_at = 0, _last_event = 0;
  TrkImpact _cand = TRK_IMP_NONE, _event = TRK_IMP_NONE;
  int _cand_moves = 0, _cand_skip = 0;
  float _gx = 0, _gy = 0, _gz = 0;     // gravity (low pass), mg
  float _rx = 0, _ry = 0, _rz = 0;     // gravity while walking: "upright", unit vector
  uint16_t _ref_n = 0;

  void learnUpright() {
    float gl = sqrtf(_gx * _gx + _gy * _gy + _gz * _gz);
    if (gl < 700 || gl > 1300) return;   // not a calm enough moment
    float a = _ref_n < TRK_MOT_REF_N ? 0.05f : 0.01f;
    if (_ref_n == 0) { _rx = _gx / gl; _ry = _gy / gl; _rz = _gz / gl; }
    else { _rx += (_gx / gl - _rx) * a; _ry += (_gy / gl - _ry) * a; _rz += (_gz / gl - _rz) * a; }
    if (_ref_n < 60000) _ref_n++;
  }
};
