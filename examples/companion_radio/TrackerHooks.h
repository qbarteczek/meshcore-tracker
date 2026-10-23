#pragma once

/*
 * Hooks used by MyMesh for the dog tracker additions (meshcore-tracker fork):
 *   TrackerMode (-D TRACKER_MODE) - the tracker itself (T1000-E),
 *   TrackerBase (-D TRACKER_BASE) - a companion carried in the field that acts as the tracker's base.
 * Only one of them is built into a firmware. Without either define MyMesh behaves like stock MeshCore.
 */

#include <Mesh.h>
#include <helpers/ContactInfo.h>

class TrackerHooks {
public:
  virtual void onAck(uint32_t ack_crc) = 0;
  // text DM received from a contact; true = consumed (the app does not get it as it is)
  virtual bool onText(const ContactInfo& from, mesh::Packet* pkt, uint32_t sender_ts, const char* text) = 0;
  // text DM the app wants to send; true = taken over here (nothing sent now, expected_ack/est_timeout set)
  virtual bool onAppText(ContactInfo& to, uint32_t ts, uint8_t attempt, const char* text,
                         uint32_t& expected_ack, uint32_t& est_timeout) { return false; }
  virtual bool setSetting(const char* name, const char* value) = 0;     // custom var; true = handled
  virtual int  formatSettings(char* dest, int max_len) = 0;             // ",name:value,..."
  virtual ~TrackerHooks() { }
};
