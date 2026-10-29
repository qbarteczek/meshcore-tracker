#pragma once

/*
 * Tracker mode for the companion firmware (built with -D TRACKER_MODE=1).
 *
 * Instead of listening all the time, the node sleeps (LoRa radio in warm sleep, GPS in RTC backup,
 * Bluetooth off) and wakes up every `interval` seconds to:
 *   1. get a fresh GPS fix (GPS woken from backup, usually a few seconds),
 *   2. send a short text report to its base node:
 *        "#T1 lat,lon,alt,batt_mv,temp_c,sats,interval_s,flags,seq"   (lat/lon/alt empty without a fix)
 *      flags: b = first report after boot, m = moved > TRK_MOVE_M since the last delivered report,
 *             n = no GPS fix, s = search mode, l = previous reports were not delivered,
 *             f = field mode (the base is the field base, see below)
 *   3. wait for the ACK and listen a few seconds for a command from the base:
 *        "#C i=<interval_s> s=<0|1> c=1 b=<h|f>"
 *        (c=1: open the Bluetooth configuration window, b: use the home / field base)
 *   4. go back to sleep.
 * The base decides the interval (at home / walk / search). The tracker shortens it on its own when it
 * has moved away from the last delivered position, and keeps trying every TRK_LOST_INTERVAL when its
 * reports are not delivered.
 *
 * Two bases:
 *   home base  = the first favourite contact that is not the field base (a node at home, e.g. on a server),
 *   field base = the favourite contact whose name starts with the custom var trk_field (a companion carried on a hike,
 *                built with -D TRACKER_BASE, see TrackerBase.h).
 * Reports go to the active base. When it does not ACK, the tracker tries the other one; whichever ACKs
 * becomes the active base. The field base is reached zero-hop first (no flooding of the mesh). In field
 * mode a copy of the report goes to the home base every TRK_HOME_CHECK_MS, so the home server keeps a
 * coarse track; either base can switch the mode with "#C b=h" / "#C b=f".
 *
 * Button: short press = report now; hold 2-6 s = Bluetooth configuration window (10 min, normal
 * companion behaviour, MeshCore app works); hold > 6 s = power off. After boot the configuration
 * window is open for TRK_BOOT_CONFIG_SECS.
 *
 * Custom vars (MeshCore app / CMD_SET_CUSTOM_VAR): tracker=0|1, trk_int=<default interval s>,
 * trk_field=<name of the field base contact, "-" = none>.
 */

#include <Arduino.h>
#include <helpers/ContactInfo.h>
#include <helpers/BaseSerialInterface.h>
#include "TrackerHooks.h"

class TrackerMode : public TrackerHooks {
public:
  void begin(BaseSerialInterface* ble);
  bool loop();          // true = this loop() iteration was handled by tracker mode
  bool isActive() const { return _state != ST_CONFIG; }

  void onAck(uint32_t ack_crc) override;
  bool onText(const ContactInfo& from, mesh::Packet* pkt, uint32_t sender_ts, const char* text) override;
  bool setSetting(const char* name, const char* value) override;
  int  formatSettings(char* dest, int max_len) override;

private:
  enum State { ST_CONFIG, ST_SLEEP, ST_GPS, ST_SEND, ST_WAIT_ACK, ST_LISTEN };
  struct Config {
    uint32_t magic;
    uint8_t enabled;
    uint8_t reserved[3];
    uint32_t interval_s;
    char field[32];       // field base contact name ("" = none); added in trk2, older files end before it
  };

  BaseSerialInterface* _ble = NULL;
  Config _cfg;
  State _state = ST_CONFIG;
  unsigned long _config_until = 0;
  bool _radio_asleep = false;

  // cycle
  unsigned long _cycle_start = 0, _next_wake = 0, _gps_wake = 0, _fresh_since = 0, _deadline = 0;
  uint32_t _interval_s = 120;
  bool _search = false, _boot_report = true, _config_requested = false, _gps_ever_fixed = false;
  bool _sos = false;               // SOS: 3 short presses; ends with #STOP (s=0) from the base
  bool _ok_pending = false;        // 2 short presses: "OK" flag in the next report
  uint8_t _buzz_pending = 0;       // beeps to play after the cycle (z=N, SOS answered)
  uint8_t _batt_warned = 0;        // 0 ok, 1 low (warned), 2 critical (warned, saving)
  uint8_t _taps = 0;
  unsigned long _last_tap = 0;
  uint8_t _attempt = 0;
  uint16_t _misses = 0;
  uint32_t _seq = 0, _msg_ts = 0, _expected_ack = 0;
  bool _got_ack = false;
  char _msg[96];

  // bases
  bool _field_mode = false;   // active base = field base
  int _field_idx = 0;         // which of the field bases (trk_field "A/B") is in use
  int _field_tries = 0;       // field bases tried in this cycle
  bool _fallback = false;     // this cycle: the active base did not ACK, trying the other one
  bool _home_check = false;   // this cycle: extra copy to the home base while in field mode
  unsigned long _last_home_check = 0;

  // position of this cycle and of the last delivered report
  bool _fix = false, _moved = false, _have_reported = false;
  double _lat = 0, _lon = 0, _alt = 0, _rep_lat = 0, _rep_lon = 0, _cand_lat = 0, _cand_lon = 0;
  long _sats = 0;

  // button
  unsigned long _btn_down = 0;

  void loadConfig();
  void saveConfig();
  void enterConfig(uint32_t secs);
  void enterTracker();
  void startCycle();
  void finishCycle();
  void composeReport();
  void newMessage();
  bool targetIsField() const { return _home_check ? false : (_field_mode != _fallback); }
  bool findBase(ContactInfo& dest, bool field, int* count = NULL);
  bool isFieldName(const char* name);
  int fieldCount() { ContactInfo b; int n = 0; findBase(b, true, &n); return n; }
  bool isBase(const ContactInfo& c);
  void setFieldMode(bool on);
  bool handleButton();
  void gpsPower(bool on);
  void blink(int n);
  void buzz(int n, int ms);
  void checkBattery();
  void runMesh();
};
