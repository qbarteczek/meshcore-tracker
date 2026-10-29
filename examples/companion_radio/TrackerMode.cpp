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
#define TRK_MAGIC              0x4B525431   // "1TRK"
#define TRK_DEFAULT_INTERVAL   120          // s, until the base sends its own
#define TRK_MIN_INTERVAL       15
#define TRK_MAX_INTERVAL       3600
#define TRK_BOOT_CONFIG_SECS   180          // Bluetooth window after power-on
#define TRK_BUTTON_CONFIG_SECS 600          // Bluetooth window after a 2-6 s button hold
#define TRK_SOS_TAPS 3                      // short presses in a row = SOS
#define TRK_SOS_GAP_MS 800UL                // max. pause between those presses
#define TRK_SOS_INTERVAL 30                 // report interval during SOS (s)
#define TRK_LOW_PCT 20                      // battery warning for the wearer: 2 beeps (once)
#define TRK_CRIT_PCT 10                     // critical: 3 beeps (once) and reports at most every TRK_CRIT_INTERVAL
#define TRK_CRIT_INTERVAL 600               // except during SOS / search
#define TRK_BATT_RESET_PCT 30               // warnings re-armed after charging
#define TRK_GPS_FIRST_MS       180000UL     // first fix after boot (cold start)
#define TRK_GPS_MAX_MS         60000UL      // later fixes (hot start from RTC backup)
#define TRK_FIX_SETTLE_MS      3000UL       // keep a fresh fix running this long before using it
#define TRK_MIN_SATS           4
#define TRK_ACK_EXTRA_MS       2500UL
#define TRK_LISTEN_MS          8000UL       // after the ACK: time for a "#C" command from the base
#define TRK_MAX_ATTEMPTS       3
#define TRK_MOVE_M             100.0        // moved this far from the last delivered position ...
#define TRK_MOVE_INTERVAL      120          // ... -> report at least this often without waiting for the base
#define TRK_LOST_INTERVAL      120          // not delivered: keep trying this often ...
#define TRK_LOST_LONG_INTERVAL 300          // ... and this often after TRK_LOST_LONG_MISSES misses
#define TRK_LOST_LONG_MISSES   10
#define TRK_KEEP_GPS_INTERVAL  60           // intervals up to this keep the GPS running between reports
#define TRK_FALLBACK_ATTEMPTS  2            // tries to the other base when the active one does not ACK
#define TRK_HOME_CHECK_MS      (15 * 60000UL)  // field mode: a copy to the home base this often
#define TRK_CONFIG_V1_SIZE     12           // trk1 config file (without the field base name)

#define timeReached trkTimeReached

// ------------------------------------------------------------------ setup / settings

void TrackerMode::begin(BaseSerialInterface* ble) {
  _ble = ble;
  loadConfig();
  _interval_s = _cfg.interval_s;
  enterConfig(TRK_BOOT_CONFIG_SECS);
}

void TrackerMode::loadConfig() {
  _cfg.magic = TRK_MAGIC;
  _cfg.enabled = 0;
  _cfg.interval_s = TRK_DEFAULT_INTERVAL;
  memset(_cfg.field, 0, sizeof(_cfg.field));
#if defined(NRF52_PLATFORM)
  File f(InternalFS);
  if (f.open(TRK_CONFIG_FILE, FILE_O_READ)) {
    Config c;
    memset(&c, 0, sizeof(c));
    int n = f.read((uint8_t*)&c, sizeof(c));
    if (n >= TRK_CONFIG_V1_SIZE && c.magic == TRK_MAGIC) _cfg = c;
    f.close();
  }
#endif
  _cfg.field[sizeof(_cfg.field) - 1] = 0;
  _cfg.interval_s = constrain(_cfg.interval_s, TRK_MIN_INTERVAL, TRK_MAX_INTERVAL);
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

bool TrackerMode::setSetting(const char* name, const char* value) {
  if (strcmp(name, "tracker") == 0) {
    _cfg.enabled = (value[0] == '1') ? 1 : 0;
    saveConfig();
    if (_state == ST_CONFIG) _config_until = millis() + 60000UL;  // leave a minute to finish configuring
    return true;
  }
  if (strcmp(name, "trk_int") == 0) {
    _cfg.interval_s = constrain((uint32_t)atoi(value), TRK_MIN_INTERVAL, TRK_MAX_INTERVAL);
    _interval_s = _cfg.interval_s;
    saveConfig();
    return true;
  }
  if (strcmp(name, "trk_field") == 0) {
    memset(_cfg.field, 0, sizeof(_cfg.field));
    if (strcmp(value, "-") != 0) strncpy(_cfg.field, value, sizeof(_cfg.field) - 1);
    if (!_cfg.field[0]) _field_mode = false;
    saveConfig();
    return true;
  }
  return false;
}

int TrackerMode::formatSettings(char* dest, int max_len) {
  return snprintf(dest, max_len, ",tracker:%u,trk_int:%lu,trk_field:%s", _cfg.enabled,
                  (unsigned long)_cfg.interval_s, _cfg.field[0] ? _cfg.field : "-");
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

void TrackerMode::runMesh() {
  the_mesh.loop();
  sensors.loop();
  rtc_clock.tick();
  board.loop();
}

// home base = first favourite that is not a field base; field bases = favourites named by trk_field
// trk_field: one or more name prefixes separated by '/' ("BAZA2/BAZA3"); a name matches when it starts with
// one of them ("BAZA2" matches "BAZA2 🏕", names often carry emoji)
bool TrackerMode::isFieldName(const char* name) {
  const char* p = _cfg.field;
  while (*p) {
    const char* e = strchr(p, '/');
    size_t n = e ? (size_t)(e - p) : strlen(p);
    if (n && strncasecmp(name, p, n) == 0) return true;
    if (!e) break;
    p = e + 1;
  }
  return false;
}

// field: the field base number _field_idx among the matching favourites (several field bases: rotate on failure)
bool TrackerMode::findBase(ContactInfo& dest, bool field, int* count) {
  if (count) *count = 0;
  if (field && !_cfg.field[0]) return false;
  ContactInfo c, first;
  int n = 0;
  bool found = false;
  ContactsIterator it = the_mesh.startContactsIterator();
  while (it.hasNext(&the_mesh, c)) {
    if (!c.isFav()) continue;
    bool is_field = _cfg.field[0] && isFieldName(c.name);
    if (is_field != field) continue;
    if (!field) { dest = c; if (count) *count = 1; return true; }   // home: the first one
    if (n == 0) first = c;
    if (n == _field_idx) { dest = c; found = true; }
    n++;
  }
  if (count) *count = n;
  if (n && !found) { _field_idx = 0; dest = first; found = true; }
  return found;
}

bool TrackerMode::isBase(const ContactInfo& c) {
  if (!c.isFav()) return false;
  ContactInfo b;
  if (findBase(b, false) && memcmp(b.id.pub_key, c.id.pub_key, PUB_KEY_SIZE) == 0) return true;
  return _cfg.field[0] && isFieldName(c.name);   // any of the field bases may send commands
}

void TrackerMode::setFieldMode(bool on) {
  ContactInfo b;
  if (on && !findBase(b, true)) on = false;              // no field base configured
  if (on && !_field_mode) _last_home_check = millis();   // home did not answer just now
  _field_mode = on;
}

// returns true when the button started something that ends the current step
bool TrackerMode::handleButton() {
#ifdef PIN_USER_BTN
  bool down = digitalRead(PIN_USER_BTN) == USER_BTN_PRESSED;
  if (down && !_btn_down) {
    _btn_down = millis() ? millis() : 1;   // 0 = not pressed (never "| 1": millis() - it would wrap)
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
    if (held >= 30UL) {          // short press: counted, decided after a pause (no blinking here - it blocks)
      _taps = (_taps && millis() - _last_tap <= TRK_SOS_GAP_MS) ? _taps + 1 : 1;
      _last_tap = millis();
    }
  }
  // end of a series of short presses: 1 = report now, 2 = "OK", 3+ = SOS
  if (!down && _taps && millis() - _last_tap > TRK_SOS_GAP_MS) {
    uint8_t n = _taps;
    _taps = 0;
    if (n >= TRK_SOS_TAPS) {     // SOS: report every 30 s, flooding, until the base answers #STOP
      _sos = _search = true;
      _interval_s = TRK_SOS_INTERVAL;
      blink(4);
      buzz(1, 500);
    } else if (n == 2) {         // "OK, all fine" - goes with the report sent right now
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

// low battery: the wearer hears it too (base and app see the percentage in every report)
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
  if (_batt_warned == 2 && !_search && _interval_s < TRK_CRIT_INTERVAL) _interval_s = TRK_CRIT_INTERVAL;
}

// buzzer (T1000-E): base command z=N and the answer to an SOS; not while waiting for an ACK
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

// ------------------------------------------------------------------ report cycle

void TrackerMode::startCycle() {
  _cycle_start = millis();
  _field_tries = 0;
  _fix = _moved = false;
  _fresh_since = 0;
  _gps_wake = millis();
  gpsPower(true);
  _deadline = millis() + (_gps_ever_fixed ? TRK_GPS_MAX_MS : TRK_GPS_FIRST_MS);
  _state = ST_GPS;
}

void TrackerMode::composeReport() {
  char* dp = _msg;
  dp += sprintf(dp, "#T1 ");
  if (_fix) {
    dp = trkFmtFixed(dp, _lat, 6); *dp++ = ',';
    dp = trkFmtFixed(dp, _lon, 6); *dp++ = ',';
    dp = trkFmtFixed(dp, _alt, 0); *dp++ = ',';
  } else {
    dp += sprintf(dp, ",,,");
  }
  dp += sprintf(dp, "%u,", (unsigned)board.getBattMilliVolts());
#if defined(T1000_E)
  dp = trkFmtFixed(dp, t1000e_get_temperature(), 1);
#endif
  dp += sprintf(dp, ",%ld,%lu,", _fix ? _sats : 0L, (unsigned long)_interval_s);
  if (_boot_report) *dp++ = 'b';
  if (_moved) *dp++ = 'm';
  if (!_fix) *dp++ = 'n';
  if (_search) *dp++ = 's';
  if (_sos) *dp++ = 'S';
  if (_ok_pending) { *dp++ = 'O'; _ok_pending = false; }
  if (_batt_warned == 2) *dp++ = 'w';   // critical battery: saving mode
  if (_misses) *dp++ = 'l';
  if (_home_check || targetIsField()) *dp++ = 'f';
  sprintf(dp, ",%lu", (unsigned long)_seq);
}

void TrackerMode::newMessage() {
  _attempt = 0;
  _msg_ts = the_mesh.getRTCClock()->getCurrentTimeUnique();
  composeReport();
  _state = ST_SEND;
}

void TrackerMode::finishCycle() {
  _fallback = _home_check = false;
  if (_buzz_pending) { buzz(_buzz_pending, 350); _buzz_pending = 0; }
  checkBattery();
  if (_interval_s > TRK_KEEP_GPS_INTERVAL) gpsPower(false);
  if (_config_requested) {
    _config_requested = false;
    enterConfig(TRK_BUTTON_CONFIG_SECS);
    return;
  }
  _next_wake = _cycle_start + _interval_s * 1000UL;
  if ((long)(_next_wake - millis()) < 5000L) _next_wake = millis() + 5000UL;
  _state = ST_SLEEP;
}

void TrackerMode::onAck(uint32_t ack_crc) {
  if (_state == ST_WAIT_ACK && _expected_ack && ack_crc == _expected_ack) _got_ack = true;
}

bool TrackerMode::onText(const ContactInfo& from, mesh::Packet* pkt, uint32_t sender_ts, const char* text) {
  if (strncmp(text, "#C", 2) != 0) return false;
  if (!isBase(from)) return false;
  for (const char* p = text + 2; *p; p++) {
    if (p[1] != '=') continue;
    long v = atol(p + 2);
    switch (p[0]) {
      case 'i':
        _interval_s = constrain((uint32_t)v, TRK_MIN_INTERVAL, TRK_MAX_INTERVAL);
        if (_batt_warned == 2 && !_search && _interval_s < TRK_CRIT_INTERVAL) _interval_s = TRK_CRIT_INTERVAL;   // saving
        break;
      case 's':
        _search = v != 0;
        if (!v && _sos) { _sos = false; _buzz_pending = 2; }   // SOS answered: two beeps for the person
        break;
      case 'z': _buzz_pending = (uint8_t)constrain(v, 1L, 10L); break;   // "call": beep N times
      case 't':   // time from the base (no RTC battery: the clock is only guessed after a reboot); also backwards
        if (v > 1700000000L) the_mesh.getRTCClock()->setCurrentTime((uint32_t)v);
        break;
      case 'c': _config_requested = v != 0; break;
      case 'b': setFieldMode(p[2] == 'f' || p[2] == '1'); break;
    }
  }
  if (_state == ST_LISTEN) _deadline = millis() + 1500UL;  // just enough to send our ACK
  return true;
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
      sensors.loop();                     // parse NMEA (the UART buffer fills fast: no long delays here)
      LocationProvider* lp = sensors.getLocationProvider();
      bool fresh = lp && lp->isValid() && lp->lastFixMillis() && (long)(lp->lastFixMillis() - _gps_wake) > 0;
      if (fresh && !_fresh_since) _fresh_since = millis();
      if (!fresh) _fresh_since = 0;
      if (_fresh_since && millis() - _fresh_since >= TRK_FIX_SETTLE_MS && lp->satellitesCount() >= TRK_MIN_SATS) {
        _fix = true;
        _gps_ever_fixed = true;
        _lat = lp->getLatitude() / 1000000.0;
        _lon = lp->getLongitude() / 1000000.0;
        _alt = lp->getAltitude() / 1000.0;
        _sats = lp->satellitesCount();
        sensors.node_lat = _lat;          // also used by adverts and telemetry requests
        sensors.node_lon = _lon;
        sensors.node_altitude = _alt;
      }
      if (_fix || timeReached(_deadline)) {
        if (_fix && _have_reported && trkDistM(_lat, _lon, _rep_lat, _rep_lon) > TRK_MOVE_M) {
          _moved = true;
          if (_interval_s > TRK_MOVE_INTERVAL) _interval_s = TRK_MOVE_INTERVAL;
        }
        if (_interval_s > TRK_KEEP_GPS_INTERVAL) gpsPower(false);
        radio_driver.wakeRadio();
        _radio_asleep = false;
        _seq++;
        _fallback = _home_check = false;
        newMessage();
      } else {
        delay(2);
      }
      return true;
    }

    case ST_SEND: {
      bool to_field = targetIsField();
      ContactInfo base;
      if (!findBase(base, to_field)) {
        if (to_field && !_fallback) { setFieldMode(false); newMessage(); }   // field base removed
        else finishCycle();
        return true;
      }
      ContactInfo* real = the_mesh.lookupContactByPubKey(base.id.pub_key, PUB_KEY_SIZE);
      int max_att = _home_check ? 1 : (_fallback ? TRK_FALLBACK_ATTEMPTS : TRK_MAX_ATTEMPTS);
      if (real) {
        if (to_field && (real->out_path_len == OUT_PATH_UNKNOWN || _attempt == 1)) {
          real->out_path_len = 0;   // the field base is usually close to the dog: zero-hop, no flooding
        }
        if (_attempt == max_att - 1 && _search && !_home_check) the_mesh.resetPathTo(*real);  // last try: flood
        if (_sos && _attempt >= 1) the_mesh.resetPathTo(*real);   // SOS: every retry floods (repeaters, other paths)
        base = *real;
      }
      uint32_t est_timeout = 0;
      _expected_ack = 0;
      _got_ack = false;
      int r = the_mesh.sendMessage(base, _msg_ts, _attempt, _msg, _expected_ack, est_timeout);
      if (r == MSG_SEND_FAILED) { finishCycle(); return true; }
      _cand_lat = _lat;
      _cand_lon = _lon;
      _deadline = millis() + (est_timeout > 3000 ? est_timeout : 3000) + TRK_ACK_EXTRA_MS;
      _state = ST_WAIT_ACK;
      return true;
    }

    case ST_WAIT_ACK:
      runMesh();
      if (_got_ack) {
        if (!_home_check) {
          if (_fallback) setFieldMode(!_field_mode);   // the other base answered: it is the base now
          _fallback = false;
          _misses = 0;
          _boot_report = false;
          if (_fix) { _rep_lat = _cand_lat; _rep_lon = _cand_lon; _have_reported = true; }
        }
        _deadline = millis() + TRK_LISTEN_MS;
        _state = ST_LISTEN;
      } else if (timeReached(_deadline)) {
        int max_att = _home_check ? 1 : (_fallback ? TRK_FALLBACK_ATTEMPTS : TRK_MAX_ATTEMPTS);
        ContactInfo other;
        if (++_attempt < max_att) {
          _state = ST_SEND;
        } else if (_home_check) {
          finishCycle();                               // home out of range: normal on a hike
        } else if (_field_mode && !_fallback && ++_field_tries < fieldCount()) {
          _field_idx++;                                // next field base (e.g. the other one is switched off)
          newMessage();
        } else if (!_fallback && findBase(other, !_field_mode)) {
          _fallback = true;                            // try the other base
          newMessage();
        } else {
          _misses++;
          uint32_t lost = _misses >= TRK_LOST_LONG_MISSES ? TRK_LOST_LONG_INTERVAL : TRK_LOST_INTERVAL;
          if (_interval_s > lost || _misses == TRK_LOST_LONG_MISSES) _interval_s = lost;
          finishCycle();
        }
      }
      return true;

    case ST_LISTEN:
      runMesh();
      if (timeReached(_deadline) && !the_mesh.hasPendingWork()) {
        ContactInfo home;
        if (_field_mode && !_home_check && !_config_requested
            && millis() - _last_home_check >= TRK_HOME_CHECK_MS && findBase(home, false)) {
          _last_home_check = millis();
          ContactInfo* real = the_mesh.lookupContactByPubKey(home.id.pub_key, PUB_KEY_SIZE);
          if (real && real->out_path_len != OUT_PATH_UNKNOWN) {   // only over a known route, never flood
            _home_check = true;
            newMessage();
            return true;
          }
        }
        finishCycle();
      }
      return true;

    default:
      return false;
  }
}

#endif  // TRACKER_MODE
