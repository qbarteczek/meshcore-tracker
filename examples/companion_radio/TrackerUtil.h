#pragma once

// Small helpers shared by TrackerMode and TrackerBase (no printf float support on nRF52).

#include <Arduino.h>
#include <math.h>
#include <stdio.h>

static inline bool trkTimeReached(unsigned long t) { return (long)(millis() - t) >= 0; }

static inline double trkDistM(double la1, double lo1, double la2, double lo2) {
  const double R = 6371000.0, k = M_PI / 180.0;
  double dla = (la2 - la1) * k, dlo = (lo2 - lo1) * k;
  double h = sin(dla / 2) * sin(dla / 2) + cos(la1 * k) * cos(la2 * k) * sin(dlo / 2) * sin(dlo / 2);
  return 2 * R * asin(sqrt(h));
}

// initial bearing from point 1 to point 2, degrees 0..359
static inline int trkBearing(double la1, double lo1, double la2, double lo2) {
  const double k = M_PI / 180.0;
  double y = sin((lo2 - lo1) * k) * cos(la2 * k);
  double x = cos(la1 * k) * sin(la2 * k) - sin(la1 * k) * cos(la2 * k) * cos((lo2 - lo1) * k);
  int b = (int)lround(atan2(y, x) / k);
  return (b + 360) % 360;
}

// "52.229700" / "-0.5" written at dp, returns the new end
static inline char* trkFmtFixed(char* dp, double v, int decimals, char sep = '.') {
  long scale = 1;
  for (int i = 0; i < decimals; i++) scale *= 10;
  long long n = llround(v * scale);
  if (n < 0) { *dp++ = '-'; n = -n; }
  dp += sprintf(dp, "%ld", (long)(n / scale));
  if (decimals > 0) {
    char fmt[8];
    sprintf(fmt, "%c%%0%dld", sep, decimals);
    dp += sprintf(dp, fmt, (long)(n % scale));
  }
  return dp;
}

// rough Li-ion state of charge from the cell voltage
static inline int trkBattPct(int mv) {
  static const int16_t mvs[] = {3300, 3500, 3600, 3700, 3800, 3900, 4000, 4100, 4200};
  static const int8_t pct[]  = {   0,    5,   15,   30,   50,   65,   80,   90,  100};
  if (mv <= mvs[0]) return 0;
  for (int i = 1; i < 9; i++) {
    if (mv <= mvs[i]) return pct[i - 1] + (pct[i] - pct[i - 1]) * (mv - mvs[i - 1]) / (mvs[i] - mvs[i - 1]);
  }
  return 100;
}
