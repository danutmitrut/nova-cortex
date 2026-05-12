// ============================================================
// Bus — tipuri de date
// ============================================================

export interface BusMessage {
  id: string;           // UUID unic per mesaj
  from: string;         // numele agentului expeditor
  to: string;           // numele agentului destinatar
  content: string;      // conținutul mesajului (text liber)
  timestamp: string;    // ISO 8601
  requiresAck: boolean; // destinatarul trebuie să confirme primirea?
}

export interface BusAck {
  messageId: string;
  from: string;         // agentul care confirmă
  timestamp: string;
}
