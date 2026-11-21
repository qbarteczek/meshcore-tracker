#include "TrackerMode.h"

#ifdef TRACKER_MODE

#include "MyMesh.h"
#include <target.h>
#include <math.h>
#include "TrackerUtil.h"
#if defined(NRF52_PLATFORM)
  #include <InternalFileSystem.h>
  using namespace Adafruit_LittleFS_Namespace;
#endif
#if defined(T1000_E)
  #include "t1000e_sensors.h"
#endif

extern MyMesh the_mesh;

#define TRK_CONFIG_FILE        "/tracker"
#define TRK_MAGIC_V1           0x4B525431   // "1TRK": trk1-trk5 (DM to a base), only "enabled" is taken over
#define TRK_MAGIC_V2           0x4B525432   // "2TRK": trk6-trk7, everything but nap/beat is taken over
#define TRK_MAGIC_V3           0x4B525433   // "3TRK": trk8-trk9, everything but idle/home is taken over
#define TRK_MAGIC              0x4B525434   // "4TRK": trk10
#define TRK_DEFAULT_IDLE_MIN   15           // no motion this long away from home = alarm
#define TRK_DEFAULT_HOME_R     150          // m
#define TRK_DEFAULT_CHANNEL    "Pies"
#define TRK_DEFAULT_MOVE_S     30           // walk; 2 copies of ~1.2 s every 30 s = 8 % airtime
#define TRK_DEFAULT_STILL_S    300
#define TRK_DEFAULT_FAST_S     20           // run; 12 %: fine for runs, the airtime guard stretches longer ones
#define TRK_OLD_MOVE_S         60           // trk7 defaults: a 2TRK file still holding them gets the new ones
#define TRK_OLD_FAST_S         30
#define TRK_DEFAULT_NAP_MIN    60           // still this long -> asleep until the accelerometer feels motion
#define TRK_DEFAULT_BEAT_MIN   120          // heartbeat while asleep
#define TRK_AIR_WINDOW_MS      3600000UL    // EU 869.4-869.65 MHz: 10 % per hour
#define TRK_AIR_LIMIT_MS       306000UL     // 85 % of the 360 s allowed: stretch the interval above this
#define TRK_AIR_SAFE_S         30           // 2 copies every 30 s = 8 %, sustainable
#define TRK_TELEMETRY_EVERY    10           // battery / temperature / satellites in every 10th report (trk9)
#define TRK_FAST_KMH_X10       70           // faster than this (GPS) = fast
#define TRK_FAST_END_KMH_X10   50           // slower than this = no longer fast
#define TRK_ACC_WAKE_GAP_S     60           // at most one early wake-up by the accelerometer per this time
#define TRK_MIN_INTERVAL       15
#define TRK_MAX_INTERVAL       3600
#define TRK_MOVE_M             40.0         // farther than this from the anchor point = moving (GPS noise ~20 m)
#define TRK_STILL_AFTER_S      180          // no such move for this long = still
#define TRK_BOOT_CONFIG_SECS   180          // Bluetooth window after power-on
#define TRK_BUTTON_CONFIG_SECS 600          // Bluetooth window after a 2-6 s button hold
#define TRK_SOS_TAPS           3
#define TRK_SOS_GAP_MS         800UL        // max. pause between presses of one series
#define TRK_SOS_INTERVAL       30
#define TRK_SOS_SECS           (15 * 60)
#define TRK_LOW_PCT            20           // 2 beeps (once)
#define TRK_CRIT_PCT           10           // 3 beeps (once), then at least TRK_CRIT_INTERVAL between reports
#define TRK_CRIT_INTERVAL      600
#define TRK_BATT_RESET_PCT     30
#define TRK_GPS_FIRST_MS       180000UL     // first fix after boot (cold start)
#define TRK_GPS_MAX_MS         45000UL      // later fixes (hot start); indoors often none: do not burn the battery
#define TRK_FIX_SETTLE_MS      3000UL
#define TRK_MIN_SATS           4
#define TRK_KEEP_GPS_INTERVAL  60           // intervals up to this keep the GPS running between reports
#define TRK_SECOND_COPY_MS     3000UL       // zero-hop copy after the routed one (routed + repeater ~2 s)

#define timeReached trkTimeReached

// ------------------------------------------------------------------ setup / settings

void TrackerMode::begin(BaseSerialInterface* ble) {
  _ble = ble;
  loadConfig();
  enterConfig(TRK_BOOT_CONFIG_SECS);
}

void TrackerMode::loadConfig() {
  memset(&_cfg, 0, sizeof(_cfg));
  _cfg.magic = TRK_MAGIC;
  _cfg.move_s = TRK_DEFAULT_MOVE_S;
  _cfg.still_s = TRK_DEFAULT_STILL_S;
  _cfg.fast_s = TRK_DEFAULT_FAST_S;
  _cfg.accel = 1;
  _cfg.nap_min = TRK_DEFAULT_NAP_MIN;
  _cfg.beat_min = TRK_DEFAULT_BEAT_MIN;
  _cfg.idle_min = TRK_DEFAULT_IDLE_MIN;
  _cfg.home_r = TRK_DEFAULT_HOME_R;
  strcpy(_cfg.channel, TRK_DEFAULT_CHANNEL);
#if defined(NRF52_PLATFORM)
  File f(InternalFS);
  if (f.open(TRK_CONFIG_FILE, FILE_O_READ)) {
    Config c = _cfg;   // a file written by trk6 is shorter: the new fields keep their defaults
    int n = f.read((uint8_t*)&c, sizeof(c));
    if (n >= (int)sizeof(Config) && c.magic == TRK_MAGIC) _cfg = c;
    else if (n >= (int)offsetof(Config, idle_min) && c.magic == TRK_MAGIC_V3) {
      _cfg = c;          // trk8/trk9: idle/home are new
      _cfg.magic = TRK_MAGIC;
      _cfg.idle_min = TRK_DEFAULT_IDLE_MIN;
      _cfg.home_r = TRK_DEFAULT_HOME_R;
      _cfg.home_lat = _cfg.home_lon = 0;
    }
    else if (n >= (int)offsetof(Config, fast_s) && c.magic == TRK_MAGIC_V2) {
      _cfg = c;          // trk6/trk7: nap/beat are new, the old default intervals become the new ones
      _cfg.magic = TRK_MAGIC;
      _cfg.nap_min = TRK_DEFAULT_NAP_MIN;
      _cfg.beat_min = TRK_DEFAULT_BEAT_MIN;
      _cfg.idle_min = TRK_DEFAULT_IDLE_MIN;
      _cfg.home_r = TRK_DEFAULT_HOME_R;
      _cfg.home_lat = _cfg.home_lon = 0;
      if (_cfg.move_s == TRK_OLD_MOVE_S) _cfg.move_s = TRK_DEFAULT_MOVE_S;
      if (_cfg.fast_s == TRK_OLD_FAST_S) _cfg.fast_s = TRK_DEFAULT_FAST_S;
    }
    else if (n >= 5 && c.magic == TRK_MAGIC_V1) _cfg.enabled = c.enabled;   // old version: keep "tracker on"
    f.close();
  }
#endif
  _cfg.channel[sizeof(_cfg.channel) - 1] = 0;
  if (_cfg.path_len > sizeof(_cfg.path)) _cfg.path_len = 0;
  _cfg.move_s = constrain(_cfg.move_s, TRK_MIN_INTERVAL, TRK_MAX_INTERVAL);
  _cfg.still_s = constrain(_cfg.still_s, TRK_MIN_INTERVAL, TRK_MAX_INTERVAL);
  if (_cfg.fast_s == 0) _cfg.fast_s = TRK_DEFAULT_FAST_S;   // padding of a trk6 file
  _cfg.fast_s = constrain(_cfg.fast_s, TRK_MIN_INTERVAL, TRK_MAX_INTERVAL);
  _cfg.accel = _cfg.accel ? 1 : 0;
  if (_cfg.nap_min > 1440) _cfg.nap_min = TRK_DEFAULT_NAP_MIN;
  _cfg.beat_min = constrain(_cfg.beat_min, 15, 1440);
  if (_cfg.idle_min > 1440) _cfg.idle_min = TRK_DEFAULT_IDLE_MIN;
  _cfg.home_r = constrain(_cfg.home_r, 30, 5000);
}

void TrackerMode::saveConfig() {
#if defined(NRF52_PLATFORM)
  InternalFS.remove(TRK_CONFIG_FILE);
  File f(InternalFS);
  if (f.open(TRK_CONFIG_FILE, FILE_O_WRITE)) {
    f.write((const uint8_t*)&_cfg, sizeof(_cfg));
    f.close();
  }
#endif
}

static int hexval(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

bool TrackerMode::setSetting(const char* name, const char* value) {
  if (strcmp(name, "tracker") == 0) {
    _cfg.enabled = (value[0] == '1') ? 1 : 0;
    if (_state == ST_CONFIG) _config_until = millis() + 60000UL;  // leave a minute to finish configuring
  } else if (strcmp(name, "trk_ch") == 0) {
    StrHelper::strncpy(_cfg.channel, value, sizeof(_cfg.channel));
  } else if (strcmp(name, "trk_path") == 0) {   // "a1" or "a1,3c" or "a13c"; "-" = none
    uint8_t n = 0;
    for (const char* p = value; p[0] && p[1] && n < sizeof(_cfg.path); ) {
      int a = hexval(p[0]), b = hexval(p[1]);
      if (a < 0 || b < 0) { p++; continue; }
      _cfg.path[n++] = (uint8_t)(a * 16 + b);
      p += 2;
    }
    _cfg.path_len = n;
  } else if (strcmp(name, "trk_move") == 0) {
    _cfg.move_s = constrain(atoi(value), TRK_MIN_INTERVAL, TRK_MAX_INTERVAL);
  } else if (strcmp(name, "trk_still") == 0) {
    _cfg.still_s = constrain(atoi(value), TRK_MIN_INTERVAL, TRK_MAX_INTERVAL);
  } else if (strcmp(name, "trk_fast") == 0) {
    _cfg.fast_s = constrain(atoi(value), TRK_MIN_INTERVAL, TRK_MAX_INTERVAL);
  } else if (strcmp(name, "trk_acc") == 0) {
    _cfg.accel = (value[0] == '1') ? 1 : 0;
    if (!_cfg.accel) _accel.off();
  } else if (strcmp(name, "trk_nap") == 0) {     // minutes, 0 = never nap
    _cfg.nap_min = constrain(atoi(value), 0, 1440);
  } else if (strcmp(name, "trk_beat") == 0) {
    _cfg.beat_min = constrain(atoi(value), 15, 1440);
  } else if (strcmp(name, "trk_idle") == 0) {     // minutes, 0 = no "bezruch" alarm
    _cfg.idle_min = constrain(atoi(value), 0, 1440);
  } else if (strcmp(name, "trk_home_r") == 0) {
    _cfg.home_r = constrain(atoi(value), 30, 5000);
  } else if (strcmp(name, "trk_home") == 0) {     // "52.22970 21.01220" (space or ';'), "-" = forget
    double la = 0, lo = 0;
    const char* sep = strpbrk(value, " ;");
    if (value[0] != '-' && sep) {
      la = atof(value);
      lo = atof(sep + 1);
    }
    if (la < -90 || la > 90 || lo < -180 || lo > 180) return false;
    _cfg.home_lat = (int32_t)lround(la * 1e6);
    _cfg.home_lon = (int32_t)lround(lo * 1e6);
  } else {
    return false;
  }
  saveConfig();
  return true;
}

int TrackerMode::formatSettings(char* dest, int max_len) {
  char path[20] = "-";
  if (_cfg.path_len) {
    char* dp = path;
    for (int i = 0; i < _cfg.path_len; i++) dp += sprintf(dp, "%02x", _cfg.path[i]);
  }
  // trk_home only says whether it is set: the coordinates would not fit in the frame (and need not travel)
  return snprintf(dest, max_len, ",tracker:%u,trk_ch:%s,trk_path:%s,trk_move:%u,trk_still:%u,trk_fast:%u,trk_acc:%u"
                  ",trk_nap:%u,trk_beat:%u,trk_idle:%u,trk_home:%u,trk_home_r:%u",
                  _cfg.enabled, _cfg.channel, path, _cfg.move_s, _cfg.still_s, _cfg.fast_s, _cfg.accel,
                  _cfg.nap_min, _cfg.beat_min, _cfg.idle_min, homeSet() ? 1 : 0, _cfg.home_r);
}

// ------------------------------------------------------------------ mode switching

void TrackerMode::enterConfig(uint32_t secs) {
  if (_radio_asleep) {
    radio_driver.wakeRadio();
    _radio_asleep = false;
  }
  gpsPower(the_mesh.getNodePrefs()->gps_enabled);   // companion behaviour while configuring
  if (_ble) _ble->enable();
  _config_until = millis() + secs * 1000UL;
  _state = ST_CONFIG;
}

void TrackerMode::enterTracker() {
  if (_ble) _ble->disable();
  if (_cfg.accel && !_accel.ok()) _accel.begin();
  _accel_wake_ok = millis() + TRK_ACC_WAKE_GAP_S * 1000UL;
  _last_move = millis();      // the nap counts from here
  _asleep = false;
  _next_wake = millis();      // report right away
  _state = ST_SLEEP;
}

// ------------------------------------------------------------------ helpers

void TrackerMode::gpsPower(bool on) {
  sensors.setSettingValue("gps", on ? "1" : "0");
}

void TrackerMode::blink(int n) {
#ifdef LED_PIN
  for (int i = 0; i < n; i++) {
    digitalWrite(LED_PIN, HIGH); delay(120);
    digitalWrite(LED_PIN, LOW);  delay(180);
  }
#endif
}

void TrackerMode::buzz(int n, int ms) {
#ifdef PIN_BUZZER
#ifdef PIN_BUZZER_EN
  pinMode(PIN_BUZZER_EN, OUTPUT);
  digitalWrite(PIN_BUZZER_EN, HIGH);
#endif
  for (int i = 0; i < n; i++) {
    tone(PIN_BUZZER, 2700);
    delay(ms);
    noTone(PIN_BUZZER);
    delay(200);
  }
#ifdef PIN_BUZZER_EN
  digitalWrite(PIN_BUZZER_EN, LOW);
#endif
#else
  blink(n);
#endif
}

void TrackerMode::runMesh() {
  the_mesh.loop();
  sensors.loop();
  rtc_clock.tick();
  board.loop();
}

// returns true when the button started something that ends the current step
bool TrackerMode::handleButton() {
#ifdef PIN_USER_BTN
  bool down = digitalRead(PIN_USER_BTN) == USER_BTN_PRESSED;
  if (down && !_btn_down) {
    _btn_down = millis() ? millis() : 1;   // 0 = not pressed
  } else if (down && millis() - _btn_down > 6000UL) {
    blink(5);
    board.powerOff();           // waits for release, wakes on the next press
  } else if (!down && _btn_down) {
    unsigned long held = millis() - _btn_down;
    _btn_down = 0;
    if (held >= 2000UL) {
      blink(3);
      enterConfig(TRK_BUTTON_CONFIG_SECS);
      return true;
    }
    if (held >= 30UL) {
      _taps = (_taps && millis() - _last_tap <= TRK_SOS_GAP_MS) ? _taps + 1 : 1;
      _last_tap = millis();
    }
  }
  // end of a series of short presses: 1 = report now, 2 = "OK", 3+ = SOS on / off
  if (!down && _taps && millis() - _last_tap > TRK_SOS_GAP_MS) {
    uint8_t n = _taps;
    _taps = 0;
    if (n >= TRK_SOS_TAPS) {
      if (_sos_until) {
        _sos_until = 0;
        buzz(2, 150);
      } else {
        _sos_until = (millis() + TRK_SOS_SECS * 1000UL) | 1;
        blink(4);
        buzz(1, 500);
      }
    } else if (n == 2) {
      _ok_pending = true;
      blink(2);
    } else {
      blink(1);
    }
    if (_state == ST_SLEEP) _next_wake = millis();
  }
#endif
  return false;
}

void TrackerMode::checkBattery() {
  int pct = trkBattPct(board.getBattMilliVolts());
  uint8_t lvl = pct <= TRK_CRIT_PCT ? 2 : (pct <= TRK_LOW_PCT ? 1 : 0);
  if (lvl > _batt_warned) {
    _batt_warned = lvl;
    blink(lvl + 1);
    buzz(lvl + 1, 120);
  } else if (pct >= TRK_BATT_RESET_PCT) {
    _batt_warned = 0;   // charged again
  }
}

// moving / still with hysteresis (GPS noise must not make it "moving")
void TrackerMode::updateMotion() {
  if (!_fix) return;
  if (!_have_pos || trkDistM(_lat, _lon, _anchor_lat, _anchor_lon) > TRK_MOVE_M) {
    _anchor_lat = _lat;
    _anchor_lon = _lon;
    _have_pos = true;
    _moving = true;
    _last_move = millis();
  } else if (_moving && millis() - _last_move >= TRK_STILL_AFTER_S * 1000UL) {
    _moving = false;
  }
}

// alarms from the accelerometer: impact / fall at once, "bezruch" when still too long away from home
void TrackerMode::checkAlarms() {
  TrkImpact e = _accel.takeImpact();
  if (e != TRK_IMP_NONE && _impact == TRK_IMP_NONE) {
    _impact = e;
    _asleep = false;
    _next_wake = millis();
  }
  unsigned long still = _accel.stillMs();
  if (still < 60000UL) _idle_sent = false;   // it moved: the next long stillness alarms again
  if (_cfg.idle_min && !_idle_sent && _accel.ok() && still >= (unsigned long)_cfg.idle_min * 60000UL
      && awayFromHome()) {
    _idle_sent = true;
    _idle_pending = true;
    _next_wake = millis();
  }
}

// home set and the last known position farther than home_r from it
bool TrackerMode::awayFromHome() {
  if (!homeSet() || !_have_pos) return false;
  double la = _fix ? _lat : _anchor_lat, lo = _fix ? _lon : _anchor_lon;
  return trkDistM(la, lo, _cfg.home_lat / 1e6, _cfg.home_lon / 1e6) > _cfg.home_r;
}

// own airtime per report cycle, kept for an hour (the mesh's own budget depends on the "af" preference)
void TrackerMode::logAirtime() {
  unsigned long ms = the_mesh.getTotalAirTime() - _air_before;
  _air_t[_air_head] = millis();
  _air_ms[_air_head] = ms > 65535UL ? 65535 : (uint16_t)ms;
  _air_head = (_air_head + 1) % AIR_LOG;
}

unsigned long TrackerMode::airtimeLastHour() {
  unsigned long sum = 0;
  for (int i = 0; i < AIR_LOG; i++) {
    if (_air_ms[i] && millis() - _air_t[i] < TRK_AIR_WINDOW_MS) sum += _air_ms[i];
  }
  return sum;
}

// ------------------------------------------------------------------ report cycle

void TrackerMode::startCycle() {
  _cycle_start = millis();
  _fix = false;
  _fresh_since = 0;
  _gps_wake = millis();
  gpsPower(true);
  LocationProvider* lp = sensors.getLocationProvider();
  if (lp) lp->syncTime();
  _deadline = millis() + (_gps_ever_fixed ? TRK_GPS_MAX_MS : TRK_GPS_FIRST_MS);
  _state = ST_GPS;
}

// the report: "<status> [telemetry] <speed k a hdop posture bz> nr<n> [ost.] <link>".
// The tail (number and position) is composed first and always fits; optional words are dropped when the text
// would not fit in one channel message (MAX_TEXT_LEN with the "<name>: " prefix).
void TrackerMode::composeReport() {
  char tail[64];
  char* tp = tail;
  tp += sprintf(tp, " nr%lu", (unsigned long)_seq);
  if (_have_pos) {
    if (!_fix) tp += sprintf(tp, " ost.");
    tp += sprintf(tp, " https://maps.google.com/?q=");
    double la = _fix ? _lat : _anchor_lat, lo = _fix ? _lon : _anchor_lon;
    tp = trkFmtFixed(tp, la, 5); *tp++ = ',';
    tp = trkFmtFixed(tp, lo, 5);
  }
  *tp = 0;
  const int room = MAX_TEXT_LEN - 1 - (int)strlen(the_mesh.getNodePrefs()->node_name) - 2 - (int)(tp - tail);

  char* dp = _msg;
  if (_sos_until) dp += sprintf(dp, "SOS");
  else if (_impact == TRK_IMP_FALL) dp += sprintf(dp, "upadek");
  else if (_impact == TRK_IMP_IMPACT) dp += sprintf(dp, "uderzenie");
  else if (_idle_pending) dp += sprintf(dp, "bezruch");
  else if (_ok_pending) dp += sprintf(dp, "OK");
  else if (_boot_report) dp += sprintf(dp, "start");
  else if (_asleep) dp += sprintf(dp, "\xC5\x9B" "pi");   // śpi
  else if (!_fix) dp += sprintf(dp, "brak GPS");
  else dp += sprintf(dp, _moving ? "idzie" : "stoi");

  char w[40];   // one optional word, appended only when it fits
  auto add = [&](const char* word) {
    int n = strlen(word);
    if ((dp - _msg) + n <= room) { memcpy(dp, word, n); dp += n; }
  };
  // battery, temperature and satellites only in every TRK_TELEMETRY_EVERY-th report (shorter = less airtime),
  // and always when they matter: start, OK, SOS, alarms, nap, low battery
  bool telemetry = (_seq % TRK_TELEMETRY_EVERY) == 1 || _boot_report || _ok_pending || _sos_until || _asleep
                   || _impact != TRK_IMP_NONE || _idle_pending || _batt_warned == 2;
  if (telemetry) {
    int mv = board.getBattMilliVolts();   // only when sent: each read switches the sensor rail on and off
    char* q = w + sprintf(w, " %d%% ", trkBattPct(mv));
    q = trkFmtFixed(q, mv / 1000.0, 2, ',');
    *q++ = 'V'; *q = 0;
    add(w);
#if defined(T1000_E)
    w[0] = ' ';
    q = trkFmtFixed(w + 1, t1000e_get_temperature(), 1, ',');
    sprintf(q, "\xC2\xB0" "C");   // °C
    add(w);
#endif
    if (_fix) { sprintf(w, " %ldsat", _sats); add(w); }
  }
  if (_batt_warned == 2) add(" bateria!");
  if (_fix && _speed_x10 >= 0) {
    sprintf(w, " %ld,%ldkm/h", _speed_x10 / 10, _speed_x10 % 10); add(w);
    if (_course >= 0 && _speed_x10 >= 20) { sprintf(w, " k%d", _course); add(w); }   // course is noise when slow
  }
  if (_accel.activity() >= 0) { sprintf(w, " a%d", _accel.activity()); add(w); }
  if (_fix && _hdop_x10 >= 0) { sprintf(w, " hdop%d,%d", _hdop_x10 / 10, _hdop_x10 % 10); add(w); }
  switch (_accel.posture()) {
    case TRK_POS_UPRIGHT: add(" pion"); break;
    case TRK_POS_SIDE:    add(" bok"); break;
    case TRK_POS_BACK:    add(" grzbiet"); break;
    default: break;
  }
  unsigned long still_min = _accel.stillMs() / 60000UL;
  if (_accel.ok() && still_min >= 1) { sprintf(w, " bz%lu", still_min); add(w); }
  strcpy(dp, tail);
}

// the routed copy first (the repeater must not have seen the zero-hop one), the zero-hop copy after it
int TrackerMode::sendReport() {
  ChannelDetails ch;
  int idx = -1;
  for (int i = 0; i < MAX_GROUP_CHANNELS; i++) {
    if (the_mesh.getChannel(i, ch) && ch.name[0] && strcasecmp(ch.name, _cfg.channel) == 0) { idx = i; break; }
  }
  if (idx < 0) return 0;   // channel not set up: nothing to send to

  uint8_t data[5 + MAX_TEXT_LEN + 1];
  uint32_t ts = the_mesh.getRTCClock()->getCurrentTimeUnique();
  memcpy(data, &ts, 4);
  data[4] = 0;   // TXT_TYPE_PLAIN
  int len = snprintf((char*)&data[5], MAX_TEXT_LEN, "%s: %s", the_mesh.getNodePrefs()->node_name, _msg);
  if (len < 0) return 0;
  if (len > MAX_TEXT_LEN - 1) len = MAX_TEXT_LEN - 1;

  int sent = 0;
  if (_cfg.path_len) {
    mesh::Packet* pkt = the_mesh.createGroupDatagram(PAYLOAD_TYPE_GRP_TXT, ch.channel, data, 5 + len);
    if (pkt) { the_mesh.sendDirect(pkt, _cfg.path, _cfg.path_len); sent++; }
  }
  mesh::Packet* pkt = the_mesh.createGroupDatagram(PAYLOAD_TYPE_GRP_TXT, ch.channel, data, 5 + len);
  if (pkt) { the_mesh.sendZeroHop(pkt, _cfg.path_len ? TRK_SECOND_COPY_MS : 0); sent++; }
  return sent;   // both are "direct" for the dispatcher counters (zero-hop = direct with an empty path)
}

void TrackerMode::finishCycle() {
  checkBattery();
  if (_fix && _speed_x10 >= 0) {
    if (_speed_x10 >= TRK_FAST_KMH_X10) _fast = true;
    else if (_speed_x10 < TRK_FAST_END_KMH_X10) _fast = false;
  }
  if (!_moving) _fast = false;
  uint32_t iv = _moving ? (_fast ? _cfg.fast_s : _cfg.move_s) : _cfg.still_s;
  if (_asleep) iv = (uint32_t)_cfg.beat_min * 60;
  _accel.resetStats();
  if (_sos_until) {
    if (timeReached(_sos_until)) _sos_until = 0;
    else iv = TRK_SOS_INTERVAL;
  }
  if (_batt_warned == 2 && !_sos_until && iv < TRK_CRIT_INTERVAL) iv = TRK_CRIT_INTERVAL;
  logAirtime();
  if (iv < TRK_AIR_SAFE_S && airtimeLastHour() > TRK_AIR_LIMIT_MS) iv = TRK_AIR_SAFE_S;
  _interval_s = iv;
  if (_interval_s > TRK_KEEP_GPS_INTERVAL) gpsPower(false);
  _next_wake = _cycle_start + _interval_s * 1000UL;
  if ((long)(_next_wake - millis()) < 5000L) _next_wake = millis() + 5000UL;
  _state = ST_SLEEP;
}

// ------------------------------------------------------------------ main state machine

bool TrackerMode::loop() {
  if (_state == ST_CONFIG) {
    if (!_cfg.enabled) return false;
    if (timeReached(_config_until) && !(_ble && _ble->isConnected())) {
      enterTracker();
    } else {
      return false;   // normal companion loop (Bluetooth, button UI, always listening)
    }
  }

  if (handleButton()) return false;

  switch (_state) {
    case ST_SLEEP:
      if (!_radio_asleep) {
        if (the_mesh.hasPendingWork()) { runMesh(); return true; }
        radio_driver.sleepRadio();
        _radio_asleep = true;
      }
      _accel.poll();
      checkAlarms();
      // standing still and the accelerometer feels sustained motion: do not wait out the long interval
      if (!_moving && !_sos_until && _batt_warned < 2 && _accel.movingNow() && timeReached(_accel_wake_ok)
          && (long)(_next_wake - millis()) > 10000L) {
        _accel_wake_ok = millis() + TRK_ACC_WAKE_GAP_S * 1000UL;
        _next_wake = millis();
        if (_asleep) {             // woken from a nap: treat as walking until the GPS says otherwise
          _asleep = false;
          _moving = true;
          _last_move = millis();
        }
      }
      if (timeReached(_next_wake)) {
        startCycle();
      } else {
        unsigned long left = _next_wake - millis();
        delay(left > 50 ? 50 : left);     // FreeRTOS tickless idle -> System ON sleep; 50 ms: short presses are seen
      }
      return true;

    case ST_GPS: {
      sensors.loop();
      LocationProvider* lp = sensors.getLocationProvider();
      bool fresh = lp && lp->isValid() && lp->lastFixMillis() && (long)(lp->lastFixMillis() - _gps_wake) > 0;
      if (fresh && !_fresh_since) _fresh_since = millis();
      if (!fresh) _fresh_since = 0;
      if (_fresh_since && millis() - _fresh_since >= TRK_FIX_SETTLE_MS && lp->satellitesCount() >= TRK_MIN_SATS) {
        _fix = true;
        _gps_ever_fixed = true;
        _lat = lp->getLatitude() / 1000000.0;
        _lon = lp->getLongitude() / 1000000.0;
        _sats = lp->satellitesCount();
        _hdop_x10 = lp->getHdopX10();
        long kn = lp->getSpeedMilliKnots(), crs = lp->getCourseMilliDeg();
        _speed_x10 = kn >= 0 ? (kn * 1852L + 50000L) / 100000L : -1;   // 1 knot = 1.852 km/h
        _course = crs >= 0 ? (int)((crs + 500) / 1000) % 360 : -1;
        sensors.node_lat = _lat;
        sensors.node_lon = _lon;
        sensors.node_altitude = lp->getAltitude() / 1000.0;
      }
      if (_fix || timeReached(_deadline)) {
        updateMotion();
        // nap only at home (or anywhere when home is not set): away, a still dog may be in trouble
        if (_moving || awayFromHome()) _asleep = false;
        else if (_cfg.nap_min && millis() - _last_move >= (unsigned long)_cfg.nap_min * 60000UL) _asleep = true;
        radio_driver.wakeRadio();
        _radio_asleep = false;
        _seq++;
        rtc_clock.tick();
        composeReport();
        _sent_before = the_mesh.getNumSentDirect();
        _air_before = the_mesh.getTotalAirTime();
        _to_send = sendReport();
        _boot_report = _ok_pending = _idle_pending = false;
        _impact = TRK_IMP_NONE;
        _send_done = millis();
        _state = ST_SEND;
      } else {
        _accel.poll();
        delay(2);
      }
      return true;
    }

    case ST_SEND:   // until both copies are on air (the radio must not go to sleep in the middle of one)
      runMesh();
      if ((int)(the_mesh.getNumSentDirect() - _sent_before) >= _to_send && !the_mesh.hasPendingWork()) finishCycle();
      else if (millis() - _send_done > 20000UL) finishCycle();   // never hang here
      return true;

    default:
      return false;
  }
}

#endif  // TRACKER_MODE
