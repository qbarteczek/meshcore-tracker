#pragma once

/*
 * Field base for the dog tracker (built with -D TRACKER_BASE=1), for a companion carried on a hike
 * (e.g. XIAO nRF52840 + Wio-SX1262 with the MeshCore app on a phone). Everything else works like the
 * stock companion; only "#T1" reports from trackers and "#..." commands typed to a tracker are handled here.
 *
 * Report from a tracker ("#T1 lat,lon,alt,mv,temp,sats,interval,flags,seq", see TrackerMode.h):
 *   - the tracker contact's position is updated, so the app's map shows the dog,
 *   - the app gets a readable message instead of the raw report: distance and direction (when this node
 *     has its own GPS fix), battery, temperature, satellites, interval and a map link,
 *   - a held command is sent back right after the ACK (the tracker listens only a few seconds then),
 *     or, without one, "#C i=<tb_int>" when the tracker uses another interval.
 * Commands typed in the app to the tracker contact are held until its next report (the tracker sleeps):
 *   #SZUKAJ  search mode, report every 30 s      #STOP     end search mode, back to tb_int
 *   #DOM     back to the home base               #BT       open the tracker's Bluetooth window
 *   #CO <s>  report interval in seconds          #C ...    raw command, e.g. "#C i=60 s=0"
 * Commands typed before the next report are merged; the app shows the message as delivered when the
 * tracker ACKs it.
 * No report for 2 intervals + 1 min -> an alarm message from the tracker contact (repeated every 10 min,
 * after 3 alarms every 30 min).
 *
 * Custom var: tb_int=<wanted report interval on a hike, s; 0 = leave the tracker's own>.
 */

#include <Arduino.h>
#include <helpers/ContactInfo.h>
#include "TrackerHooks.h"

class TrackerBase : public TrackerHooks {
public:
  void begin();
  void loop();

  void onAck(uint32_t ack_crc) override;
  bool onText(const ContactInfo& from, mesh::Packet* pkt, uint32_t sender_ts, const char* text) override;
  bool onAppText(ContactInfo& to, uint32_t ts, uint8_t attempt, const char* text,
                 uint32_t& expected_ack, uint32_t& est_timeout) override;
  bool setSetting(const char* name, const char* value) override;
  int  formatSettings(char* dest, int max_len) override;
  void onTimeSet() override { _clock_ok = true; }   // only then our time is good enough to give to trackers
  bool _clock_ok = false;

private:
  struct Config {
    uint32_t magic;
    uint32_t field_int;
  };
  struct Tracker {
    bool used;
    uint8_t key[PUB_KEY_SIZE];
    unsigned long last_ms;      // last report (0 = none yet)
    uint32_t interval_s;
    uint32_t seq;
    bool fix;
    double lat, lon;
    uint8_t alarms;
    unsigned long alarm_ms;
    // command held for the next report
    char cmd[48];
    bool cmd_user;              // typed in the app (kept until ACKed) / automatic (sent once)
    uint32_t cmd_ts, cmd_ack;
    uint8_t cmd_attempt;
    unsigned long send_at;      // 0 = nothing to send now
  };
  enum { MAX_TRACKERS = 4 };

  Config _cfg;
  Tracker _t[MAX_TRACKERS];

  void loadConfig();
  void saveConfig();
  Tracker& slot(const uint8_t* key);
  bool ownFix(double& lat, double& lon);
  char* writeWhere(char* dp, const Tracker& t);
  void sendCmd(Tracker& t);
};
