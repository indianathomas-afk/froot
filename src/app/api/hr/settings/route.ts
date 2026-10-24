import { NextResponse } from "next/server"

// HR-16's PUT /api/hr/settings wrote Organization.hrAckRecipients. RETIRED BY
// NOTIFY-12: migration 20261023200000_notify12_recipients copied every address
// into the address book and an "hr.ack" pick, and from that release nothing
// reads the column (F1, preserve-and-mark; DEBT-121 drops it). Writing it now
// would save a list nobody sends to, so the route refuses rather than accepts.
//
// Signed-acknowledgment recipients are set with PUT /api/notify/recipients/hr.ack
// (contacts from /api/notify/contacts).

export async function PUT() {
  return NextResponse.json(
    {
      error:
        "Signed-acknowledgment recipients moved to Settings → Email notifications. Use PUT /api/notify/recipients/hr.ack.",
    },
    { status: 410 }
  )
}
