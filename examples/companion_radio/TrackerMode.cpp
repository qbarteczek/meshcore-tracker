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
#define TRK_MAGIC              0x4B525432   // "2TRK": channel version
#define TRK_DEFAULT_CHANNEL    "Pies"
#define TRK_DEFAULT_MOVE_S     60           // chosen by simulation: 30 s = 2x airtime, ~same result
#define TRK_DEFAULT_STILL_S    300
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
  strcpy(_cfg.channel, TRK_DEFAULT_CHANNEL);
#if defined(NRF52_PLATFORM)
  File f(InternalFS);
  if (f.open(TRK_CONFIG_FILE, FILE_O_READ)) {
    Config c;
    memset(&c, 0, sizeof(c));
    int n = f.read((uint8_t*)&c, sizeof(c));
    if (n == (int)sizeof(c) && c.magic == TRK_MAGIC) _cfg = c;
    else if (n >= 5 && c.magic == TRK_MAGIC_V1) _cfg.enabled = c.enabled;   // old version: keep "tracker on"
    f.close();
  }
#endif
  _cfg.channel[sizeof(_cfg.channel) - 1] = 0;
  if (_cfg.path_len > sizeof(_cfg.path)) _cfg.path_len = 0;
  _cfg.move_s = constrain(_cfg.move_s, TRK_MIN_INTERVAL, TRK_MAX_INTERVAL);
  _cfg.still_s = constrain(_cfg.still_s, TRK_MIN_INTERVAL, TRK_MAX_INTERVAL);
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
  return snprintf(dest, max_len, ",tracker:%u,trk_ch:%s,trk_path:%s,trk_move:%u,trk_still:%u", _cfg.enabled,
                  _cfg.channel, path, _cfg.move_s, _cfg.still_s);
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

void TrackerMode::composeReport() {
  char* dp = _msg;
  int mv = board.getBattMilliVolts();
  if (_sos_until) dp += sprintf(dp, "SOS");
  else if (_ok_pending) dp += sprintf(dp, "OK");
  else if (_boot_report) dp += sprintf(dp, "start");
  else if (!_fix) dp += sprintf(dp, "brak GPS");
  else dp += sprintf(dp, _moving ? "idzie" : "stoi");
  dp += sprintf(dp, " %d%% ", trkBattPct(mv));
  dp = trkFmtFixed(dp, mv / 1000.0, 2, ',');
  *dp++ = 'V';
#if defined(T1000_E)
  *dp++ = ' ';
  dp = trkFmtFixed(dp, t1000e_get_temperature(), 1, ',');
  dp += sprintf(dp, "\xC2\xB0" "C");   // °C
#endif
  if (_fix) dp += sprintf(dp, " %ldsat", _sats);
  if (_batt_warned == 2) dp += sprintf(dp, " bateria!");
  dp += sprintf(dp, " nr%lu", (unsigned long)_seq);
  if (_have_pos) {
    if (!_fix) dp += sprintf(dp, " ost.");
    dp += sprintf(dp, " https://maps.google.com/?q=");
    double la = _fix ? _lat : _anchor_lat, lo = _fix ? _lon : _anchor_lon;
    dp = trkFmtFixed(dp, la, 5); *dp++ = ',';
    dp = trkFmtFixed(dp, lo, 5);
  }
  *dp = 0;
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
  uint32_t iv = _moving ? _cfg.move_s : _cfg.still_s;
  if (_sos_until) {
    if (timeReached(_sos_until)) _sos_until = 0;
    else iv = TRK_SOS_INTERVAL;
  }
  if (_batt_warned == 2 && !_sos_until && iv < TRK_CRIT_INTERVAL) iv = TRK_CRIT_INTERVAL;
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
        sensors.node_lat = _lat;
        sensors.node_lon = _lon;
        sensors.node_altitude = lp->getAltitude() / 1000.0;
      }
      if (_fix || timeReached(_deadline)) {
        updateMotion();
        radio_driver.wakeRadio();
        _radio_asleep = false;
        _seq++;
        rtc_clock.tick();
        composeReport();
        _sent_before = the_mesh.getNumSentDirect();
        _to_send = sendReport();
        _boot_report = _ok_pending = false;
        _send_done = millis();
        _state = ST_SEND;
      } else {
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
