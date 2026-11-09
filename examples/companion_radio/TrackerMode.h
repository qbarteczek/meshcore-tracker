#pragma once

/*
 * Tracker mode for the companion firmware (built with -D TRACKER_MODE=1). Version 2 ("channel"): simple.
 *
 * The node sleeps (LoRa radio in warm sleep, GPS in RTC backup or off, Bluetooth off) and wakes up to
 * post one text message to a private group channel (default "Pies", set with trk_ch):
 *     "<status> 93% 4,18V 9,3°C 12sat nr81 https://maps.google.com/?q=52.22970,21.01220"
 *   status: start (first after power-on), idzie (moving), stoi (still), OK (2 presses), SOS (3 presses),
 *           brak GPS (no fix: the link is the last known position, marked "ost.")
 * No ACKs, no bases, no modes, no commands: whoever has the channel and hears the packet shows it.
 * The same packet goes out twice:
 *   1. over a fixed route (trk_path, e.g. the hash of the roof repeater): the repeater passes it on once,
 *      so the home node hears it without flooding the mesh,
 *   2. zero-hop a few seconds later: a companion carried by the walker hears it directly.
 * Order matters: a repeater that already saw the zero-hop copy would not forward the routed one.
 * Receivers see one message (same payload = same packet hash, duplicates dropped).
 *
 * Interval, decided by the tracker alone: TRK moving (moved > TRK_MOVE_M from the anchor point) -> move_s,
 * still for TRK_STILL_AFTER_S -> still_s. SOS: every TRK_SOS_INTERVAL for TRK_SOS_SECS (3 presses again = end).
 *
 * Button: 1 press = report now; 2 = "OK"; 3 = SOS / end of SOS; hold 2-6 s = Bluetooth configuration window
 * (10 min, normal companion, MeshCore app works); hold > 6 s = power off. After boot the window is open for
 * TRK_BOOT_CONFIG_SECS.
 *
 * Custom vars: tracker=0|1, trk_ch=<channel name>, trk_path=<hex hashes of the route, "-" = none>,
 * trk_move=<s>, trk_still=<s>.
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

  void onAck(uint32_t ack_crc) override { }
  bool onText(const ContactInfo& from, mesh::Packet* pkt, uint32_t sender_ts, const char* text) override { return false; }
  bool setSetting(const char* name, const char* value) override;
  int  formatSettings(char* dest, int max_len) override;

private:
  enum State { ST_CONFIG, ST_SLEEP, ST_GPS, ST_SEND };
  struct Config {
    uint32_t magic;
    uint8_t enabled;
    uint8_t path_len;      // route of the first copy (number of 1-byte hashes), 0 = only zero-hop
    uint8_t path[8];
    uint16_t move_s, still_s;
    char channel[32];
  };

  BaseSerialInterface* _ble = NULL;
  Config _cfg;
  State _state = ST_CONFIG;
  unsigned long _config_until = 0;
  bool _radio_asleep = false;

  // cycle
  unsigned long _cycle_start = 0, _next_wake = 0, _gps_wake = 0, _fresh_since = 0, _deadline = 0;
  unsigned long _send_done = 0;
  uint32_t _sent_before = 0;
  int _to_send = 0;
  uint32_t _interval_s = 60;
  bool _boot_report = true, _gps_ever_fixed = false, _ok_pending = false;
  unsigned long _sos_until = 0;    // != 0: SOS running
  uint8_t _batt_warned = 0;        // 0 ok, 1 low (warned), 2 critical (warned, saving)
  uint8_t _taps = 0;
  unsigned long _last_tap = 0, _btn_down = 0;
  uint32_t _seq = 0;
  char _msg[120];

  // position
  bool _fix = false, _have_pos = false, _moving = true;
  double _lat = 0, _lon = 0, _anchor_lat = 0, _anchor_lon = 0;
  long _sats = 0;
  unsigned long _last_move = 0;

  void loadConfig();
  void saveConfig();
  void enterConfig(uint32_t secs);
  void enterTracker();
  void startCycle();
  void finishCycle();
  void composeReport();
  int sendReport();      // number of packets queued
  void updateMotion();
  bool handleButton();
  void gpsPower(bool on);
  void blink(int n);
  void buzz(int n, int ms);
  void checkBattery();
  void runMesh();
};
