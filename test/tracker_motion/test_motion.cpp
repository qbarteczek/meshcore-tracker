// Motion logic of tracker mode on a computer, with synthetic accelerometer traces (20 Hz, mg).
//   g++ -std=c++17 -O1 -I examples/companion_radio test/tracker_motion/test_motion.cpp -o /tmp/test_motion && /tmp/test_motion
#include <cstdio>
#include <cmath>
#include "TrackerMotion.h"

static int failures = 0;
#define CHECK(cond, ...) do { if (!(cond)) { failures++; printf("FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

struct Rig {
  TrackerMotion m;
  unsigned long t = 1000;
  Rig() { m.reset(t); }
  // gravity along unit vector (gx, gy, gz) plus a wobble of amplitude amp (mg) at f Hz
  void run(float secs, float gx, float gy, float gz, float amp = 0, float f = 2.0f) {
    int n = (int)(secs * 1000 / TRK_MOT_SAMPLE_MS);
    for (int i = 0; i < n; i++) {
      float w = amp * sinf(2 * 3.14159f * f * t / 1000.0f);
      m.feed((int)(gx * 1000 + w * 0.3f), (int)(gy * 1000 + w * 0.5f), (int)(gz * 1000 + w), t);
      t += TRK_MOT_SAMPLE_MS;
    }
  }
  void sample(int x, int y, int z, int count = 1) {
    for (int i = 0; i < count; i++) { m.feed(x, y, z, t); t += TRK_MOT_SAMPLE_MS; }
  }
};

int main() {
  // mounted on the back: gravity along -z while the dog stands
  {   // walking: moving, activity, posture upright after learning, no impact
    Rig r;
    r.run(60, 0, 0, -1, 400, 1.8f);
    CHECK(r.m.movingNow(), "walking should be moving");
    CHECK(r.m.activity() > 5, "activity while walking: %d", r.m.activity());
    CHECK(r.m.posture() == TRK_POS_UPRIGHT, "posture while walking: %d", r.m.posture());
    CHECK(r.m.takeImpact() == TRK_IMP_NONE, "no impact while walking");
  }
  {   // jump: landing jolt, then it runs on -> no alarm
    Rig r;
    r.run(30, 0, 0, -1, 400);
    r.sample(0, 0, -3800, 2);
    r.run(40, 0, 0, -1, 500, 2.5f);
    CHECK(r.m.takeImpact() == TRK_IMP_NONE, "landing and running on must not alarm");
  }
  {   // impact, then lying still -> impact
    Rig r;
    r.run(30, 0, 0, -1, 400);
    r.sample(1500, 800, -3900, 2);
    r.run(35, 0, 0, -1, 0);
    CHECK(r.m.takeImpact() == TRK_IMP_IMPACT, "impact then still should alarm");
    CHECK(r.m.takeImpact() == TRK_IMP_NONE, "the alarm is given once");
  }
  {   // free fall, impact, still on its side -> fall, posture side
    Rig r;
    r.run(40, 0, 0, -1, 400);
    r.sample(30, 20, -40, 6);          // 300 ms of free fall
    r.sample(2000, 0, -3900, 2);
    r.run(35, -1, 0, 0, 0);            // lying on its side
    CHECK(r.m.takeImpact() == TRK_IMP_FALL, "free fall + impact should be a fall");
    CHECK(r.m.posture() == TRK_POS_SIDE, "posture on its side: %d", r.m.posture());
  }
  {   // on its back
    Rig r;
    r.run(40, 0, 0, -1, 400);
    r.run(10, 0, 0, 1, 0);
    CHECK(r.m.posture() == TRK_POS_BACK, "posture on its back: %d", r.m.posture());
  }
  {   // no posture before the first walk; still time counts
    Rig r;
    r.run(5, 0, 0, -1, 0);
    CHECK(r.m.posture() == TRK_POS_UNKNOWN, "posture unknown before learning");
    r.run(5, 0, 0, -1, 400);
    unsigned long moved = r.t;
    r.run(120, 0, 0, -1, 0);
    unsigned long still = r.m.stillMs(r.t);
    CHECK(still >= 119000 && still <= 121000, "still for %lu ms (moved at %lu)", still, moved);
    CHECK(!r.m.movingNow(), "not moving when still");
  }
  printf(failures ? "%d failures\n" : "all motion tests passed\n", failures);
  return failures ? 1 : 0;
}
