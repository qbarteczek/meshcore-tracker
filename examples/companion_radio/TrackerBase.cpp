#include "TrackerBase.h"

#ifdef TRACKER_BASE

#include "MyMesh.h"
#include "TrackerUtil.h"
#include <target.h>
#include <Utils.h>
#if defined(NRF52_PLATFORM)
  #include <InternalFileSystem.h>
  using namespace Adafruit_LittleFS_Namespace;
#endif

extern MyMesh the_mesh;

#define TB_CONFIG_FILE      "/trkbase"
#define TB_MAGIC            0x53414254   // "TBAS"
#define TB_DEFAULT_INT      60           // s, wanted tracker interval on a hike
#define TB_SEARCH_INT       30           // s, #SZUKAJ
#define TB_REPLY_DELAY_MS   1500UL       // send the command after our ACK has gone out
#define TB_ALARM_GRACE_MS   60000UL
#define TB_ALARM_REPEAT_MS  (10 * 60000UL)
#define TB_ALARM_SLOW_MS    (30 * 60000UL)
#define TB_LOW_BATT_MV      3550

// ------------------------------------------------------------------ setup / settings

void TrackerBase::begin() {
  memset(_t, 0, sizeof(_t));
  loadConfig();
}

void TrackerBase::loadConfig() {
  _cfg.magic = TB_MAGIC;
  _cfg.field_int = TB_DEFAULT_INT;
#if defined(NRF52_PLATFORM)
  File f(InternalFS);
  if (f.open(TB_CONFIG_FILE, FILE_O_READ)) {
    Config c;
    if (f.read((uint8_t*)&c, sizeof(c)) == sizeof(c) && c.magic == TB_MAGIC) _cfg = c;
    f.close();
  }
#endif
}

void TrackerBase::saveConfig() {
#if defined(NRF52_PLATFORM)
  InternalFS.remove(TB_CONFIG_FILE);
  File f(InternalFS);
  if (f.open(TB_CONFIG_FILE, FILE_O_WRITE)) {
    f.write((const uint8_t*)&_cfg, sizeof(_cfg));
    f.close();
  }
#endif
}

bool TrackerBase::setSetting(const char* name, const char* value) {
  if (strcmp(name, "tb_int") != 0) return false;
  long v = atol(value);
  _cfg.field_int = v <= 0 ? 0 : constrain(v, 15, 3600);
  saveConfig();
  return true;
}

int TrackerBase::formatSettings(char* dest, int max_len) {
  return snprintf(dest, max_len, ",tb_int:%lu", (unsigned long)_cfg.field_int);
}

// ------------------------------------------------------------------ helpers

TrackerBase::Tracker& TrackerBase::slot(const uint8_t* key) {
  Tracker* oldest = &_t[0];
  for (int i = 0; i < MAX_TRACKERS; i++) {
    if (_t[i].used && memcmp(_t[i].key, key, PUB_KEY_SIZE) == 0) return _t[i];
  }
  for (int i = 0; i < MAX_TRACKERS; i++) {
    if (!_t[i].used) { oldest = &_t[i]; break; }
    if (_t[i].last_ms < oldest->last_ms) oldest = &_t[i];
  }
  memset(oldest, 0, sizeof(*oldest));
  oldest->used = true;
  memcpy(oldest->key, key, PUB_KEY_SIZE);
  return *oldest;
}

bool TrackerBase::ownFix(double& lat, double& lon) {
  LocationProvider* lp = sensors.getLocationProvider();
  if (!lp || !lp->isValid()) return false;
  lat = lp->getLatitude() / 1000000.0;
  lon = lp->getLongitude() / 1000000.0;
  return lat != 0 || lon != 0;
}

// "1,2 km PN-WSCH" from this node to the tracker (nothing without both fixes)
char* TrackerBase::writeWhere(char* dp, const Tracker& t) {
  static const char* dirs[] = {"PN", "PN-WSCH", "WSCH", "PD-WSCH", "PD", "PD-ZACH", "ZACH", "PN-ZACH"};
  double la, lo;
  if (!t.fix || !ownFix(la, lo)) return dp;
  double d = trkDistM(la, lo, t.lat, t.lon);
  if (d < 1000) dp += sprintf(dp, "%ld m", (long)lround(d));
  else { dp = trkFmtFixed(dp, d / 1000.0, d < 10000 ? 1 : 0, ','); dp += sprintf(dp, " km"); }
  if (d >= 10) dp += sprintf(dp, " %s", dirs[((trkBearing(la, lo, t.lat, t.lon) + 22) / 45) % 8]);
  return dp;
}

static char* writeLink(char* dp, double lat, double lon) {
  dp += sprintf(dp, "https://maps.google.com/?q=");
  dp = trkFmtFixed(dp, lat, 5);
  *dp++ = ',';
  dp = trkFmtFixed(dp, lon, 5);
  *dp = 0;
  return dp;
}

// "#C i=60 s=1" tokens -> values (empty = not set); order of the result: i s b c z
#define CMD_NKEYS 5
struct CmdSet { char v[CMD_NKEYS][8]; };
static const char CMD_KEYS[CMD_NKEYS] = {'i', 's', 'b', 'c', 'z'};

static void cmdParse(CmdSet& cs, const char* text) {
  for (const char* p = text; *p; p++) {
    if (p[1] != '=') continue;
    for (int k = 0; k < CMD_NKEYS; k++) {
      if (p[0] != CMD_KEYS[k]) continue;
      int n = 0;
      const char* q = p + 2;
      while (*q && *q != ' ' && n < 7) cs.v[k][n++] = *q++;
      cs.v[k][n] = 0;
    }
  }
}

static void cmdFormat(char* dest, const CmdSet& cs) {
  char* dp = dest + sprintf(dest, "#C");
  for (int k = 0; k < CMD_NKEYS; k++) {
    if (cs.v[k][0]) dp += sprintf(dp, " %c=%s", CMD_KEYS[k], cs.v[k]);
  }
}

void TrackerBase::sendCmd(Tracker& t) {
  t.send_at = 0;
  ContactInfo* c = the_mesh.lookupContactByPubKey(t.key, PUB_KEY_SIZE);
  if (!c || !t.cmd[0]) return;
  uint32_t ack = 0, est = 0;
  the_mesh.sendMessage(*c, t.cmd_ts, t.cmd_attempt, t.cmd, ack, est);
  if (!t.cmd_user) {
    t.cmd[0] = 0;              // automatic: decided again at the next report
  } else {
    t.cmd_ack = ack;           // typed in the app: held until the tracker ACKs it
  }
}

// ------------------------------------------------------------------ hooks

void TrackerBase::onAck(uint32_t ack_crc) {
  for (int i = 0; i < MAX_TRACKERS; i++) {
    if (_t[i].used && _t[i].cmd_ack && _t[i].cmd_ack == ack_crc) {
      _t[i].cmd[0] = 0;
      _t[i].cmd_ack = 0;
      _t[i].cmd_user = false;
    }
  }
}

bool TrackerBase::onText(const ContactInfo& from, mesh::Packet* pkt, uint32_t sender_ts, const char* text) {
  if (strncmp(text, "#T1 ", 4) != 0) return false;

  // "lat,lon,alt,mv,temp,sats,interval,flags,seq" (empty fields allowed)
  char buf[100];
  StrHelper::strncpy(buf, text + 4, sizeof(buf));
  char* f[9];
  int n = 0;
  char* p = buf;
  while (n < 9) {
    f[n++] = p;
    char* comma = strchr(p, ',');
    if (!comma) break;
    *comma = 0;
    p = comma + 1;
  }
  if (n < 9) return false;   // not a report we understand: let the app show it

  Tracker& t = slot(from.id.pub_key);
  bool repeat = t.last_ms && t.seq == (uint32_t)atol(f[8]) && millis() - t.last_ms < 60000UL;
  bool was_lost = t.alarms > 0;
  t.last_ms = millis() ? millis() : 1;   // 0 = no report yet (never "| 1": that can be 1 ms in the future)
  t.interval_s = atol(f[6]);
  t.seq = atol(f[8]);
  t.alarms = 0;
  const char* flags = f[7];
  bool fix = f[0][0] && f[1][0];
  ContactInfo* real = the_mesh.lookupContactByPubKey(from.id.pub_key, PUB_KEY_SIZE);
  if (fix) {
    t.fix = true;
    t.lat = atof(f[0]);
    t.lon = atof(f[1]);
    if (real) {
      real->gps_lat = (int32_t)lround(t.lat * 1000000.0);
      real->gps_lon = (int32_t)lround(t.lon * 1000000.0);
      the_mesh.contactLocationUpdated(*real);   // dog on the app's map
    }
  }
  // came zero-hop and we have no route back: answer zero-hop too (no flooding of the mesh)
  if (real && pkt && pkt->isRouteDirect() && pkt->getPathHashCount() == 0 && real->out_path_len == OUT_PATH_UNKNOWN) {
    real->out_path_len = 0;
  }

  // command for the tracker: held from the app, or the hike interval
  if (!t.cmd[0] && _cfg.field_int && !strchr(flags, 's') && t.interval_s != _cfg.field_int) {
    sprintf(t.cmd, "#C i=%lu", (unsigned long)_cfg.field_int);
    t.cmd_user = false;
    t.cmd_ts = the_mesh.getRTCClock()->getCurrentTimeUnique();
    t.cmd_attempt = 0;
  }
  if (t.cmd[0]) t.send_at = (millis() + TB_REPLY_DELAY_MS) | 1;

  if (repeat) return true;   // retransmission: the app already has it

  // readable message for the app
  char msg[220];   // the app frame keeps ~160 characters; the map link comes last
  char* dp = msg;
  if (strchr(flags, 'S')) dp += sprintf(dp, "\xF0\x9F\x86\x98 SOS \xC2\xB7 ");   // "🆘 SOS · " (3 presses on the tracker)
  if (strchr(flags, 'O')) dp += sprintf(dp, "\xF0\x9F\x91\x8D OK \xC2\xB7 ");     // "👍 OK · " (2 presses: all fine)
  if (was_lost) dp += sprintf(dp, "\xE2\x9C\x85 kontakt wr\xC3\xB3" "ci\xC5\x82 \xC2\xB7 ");   // "✅ kontakt wrócił · "
  if (fix) {
    char* w = writeWhere(dp, t);
    if (w == dp) dp += sprintf(dp, "GPS ok");
    else dp = w;
  } else {
    dp += sprintf(dp, "bez GPS");
  }
  int mv = atoi(f[3]);
  if (mv) {
    dp += sprintf(dp, " \xC2\xB7 ");
    dp = trkFmtFixed(dp, mv / 1000.0, 2, ',');
    dp += sprintf(dp, " V %d%%", trkBattPct(mv));
    if (mv < TB_LOW_BATT_MV) dp += sprintf(dp, " \xE2\x9A\xA0");   // ⚠
  }
  if (f[4][0]) {
    dp += sprintf(dp, " \xC2\xB7 ");
    dp = trkFmtFixed(dp, atof(f[4]), 0);
    dp += sprintf(dp, "\xC2\xB0" "C");
  }
  if (fix) dp += sprintf(dp, " \xC2\xB7 %s sat", f[5]);
  dp += sprintf(dp, " \xC2\xB7 co %lu s", (unsigned long)t.interval_s);
  if (strchr(flags, 's') && !strchr(flags, 'S')) dp += sprintf(dp, " \xC2\xB7 SZUKANIE");   // SOS implies search
  if (strchr(flags, 'l')) dp += sprintf(dp, " \xC2\xB7 po przerwie");
  if (t.fix) {
    if (!fix) dp += sprintf(dp, "\nostatnio: ");
    else *dp++ = '\n';
    dp = writeLink(dp, t.lat, t.lon);
  }
  *dp = 0;
  int8_t snr4 = pkt ? (int8_t)(pkt->getSNR() * 4) : 0;
  the_mesh.queueLocalText(from, the_mesh.getRTCClock()->getCurrentTime(), msg, snr4);
  return true;
}

bool TrackerBase::onAppText(ContactInfo& to, uint32_t ts, uint8_t attempt, const char* text,
                            uint32_t& expected_ack, uint32_t& est_timeout) {
  if (text[0] != '#') return false;
  char cmd[48];
  if (strncasecmp(text, "#C ", 3) == 0)              StrHelper::strncpy(cmd, text, sizeof(cmd));
  else if (strcasecmp(text, "#SZUKAJ") == 0)         sprintf(cmd, "#C s=1 i=%d", TB_SEARCH_INT);
  else if (strcasecmp(text, "#STOP") == 0)           sprintf(cmd, "#C s=0 i=%lu", (unsigned long)(_cfg.field_int ? _cfg.field_int : 120));
  else if (strcasecmp(text, "#DOM") == 0)            strcpy(cmd, "#C b=h");
  else if (strcasecmp(text, "#BT") == 0)             strcpy(cmd, "#C c=1");
  else if (strcasecmp(text, "#DZWON") == 0)          strcpy(cmd, "#C z=3");   // tracker beeps 3x (call back / find it)
  else if (strncasecmp(text, "#CO ", 4) == 0)        sprintf(cmd, "#C i=%ld", constrain(atol(text + 4), 15L, 3600L));
  else return false;   // other text: a normal message

  Tracker& t = slot(to.id.pub_key);
  CmdSet cs;
  memset(&cs, 0, sizeof(cs));
  if (t.cmd[0] && t.cmd_user) cmdParse(cs, t.cmd + 2);   // merge with what is still waiting
  cmdParse(cs, cmd + 2);
  cmdFormat(t.cmd, cs);
  t.cmd_user = true;
  t.cmd_ts = ts;
  t.cmd_attempt = attempt;
  t.send_at = 0;

  // the ACK the tracker will send for exactly this message (same hash as BaseChatMesh::composeMsgPacket)
  uint8_t temp[5 + sizeof(t.cmd)];
  int len = strlen(t.cmd);
  memcpy(temp, &ts, 4);
  temp[4] = attempt & 3;
  memcpy(&temp[5], t.cmd, len);
  mesh::Utils::sha256((uint8_t*)&expected_ack, 4, temp, 5 + len, the_mesh.self_id.pub_key, PUB_KEY_SIZE);
  t.cmd_ack = expected_ack;

  // the app waits until the next report is due (+ margin)
  uint32_t wait_ms = 300000UL;
  if (t.last_ms && t.interval_s) {
    long left = (long)(t.last_ms + t.interval_s * 1000UL - millis());
    wait_ms = (left > 10000L ? left : 10000L) + 30000UL;
  }
  est_timeout = wait_ms;
  return true;
}

// ------------------------------------------------------------------ alarms, delayed commands

void TrackerBase::loop() {
  for (int i = 0; i < MAX_TRACKERS; i++) {
    Tracker& t = _t[i];
    if (!t.used) continue;
    if (t.send_at && trkTimeReached(t.send_at)) sendCmd(t);

    if (!t.last_ms || !t.interval_s) continue;
    long quiet_l = (long)(millis() - t.last_ms);
    if (quiet_l < 0) continue;
    unsigned long quiet = quiet_l;
    if (quiet < 2 * t.interval_s * 1000UL + TB_ALARM_GRACE_MS) continue;
    unsigned long every = t.alarms >= 3 ? TB_ALARM_SLOW_MS : TB_ALARM_REPEAT_MS;
    if (t.alarms && millis() - t.alarm_ms < every) continue;
    ContactInfo* c = the_mesh.lookupContactByPubKey(t.key, PUB_KEY_SIZE);
    if (!c) continue;
    t.alarms++;
    t.alarm_ms = millis();
    char msg[160];
    char* dp = msg + sprintf(msg, "\xE2\x9A\xA0 brak meldunku od %lu min", quiet / 60000UL);   // ⚠
    if (t.fix) {
      char where[24];
      *writeWhere(where, t) = 0;
      if (where[0]) dp += sprintf(dp, ", ostatnio %s", where);
      *dp++ = '\n';
      dp = writeLink(dp, t.lat, t.lon);
    }
    *dp = 0;
    the_mesh.queueLocalText(*c, the_mesh.getRTCClock()->getCurrentTime(), msg);
  }
}

#endif  // TRACKER_BASE
