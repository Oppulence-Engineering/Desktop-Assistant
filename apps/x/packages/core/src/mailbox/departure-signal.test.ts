import { describe, expect, it } from "vitest";
import { detectDepartureSignal } from "./departure-signal.js";

/**
 * Bounces and departure autoreplies are the cheapest reliable evidence that a
 * contact has left, and the desktop was discarding all of it — `isMachineSender`
 * classifies mailer-daemon and postmaster as systems and nothing looked again.
 *
 * The tests that matter here are the negative ones. A false departure retires a
 * live contact and stops the user chasing someone who is still there, which is
 * worse than never having read the bounce at all.
 */

const SELF = new Set(["me@myco.example"]);

describe("hard bounces", () => {
  it("reads a 5.1.1 unknown recipient as a departure signal", () => {
    const signal = detectDepartureSignal(
      {
        from: "mailer-daemon@googlemail.com",
        subject: "Delivery Status Notification (Failure)",
        body: "Your message to sarah@acme.example was not delivered.\n550 5.1.1 The email account that you tried to reach does not exist.",
      },
      SELF,
    );
    expect(signal?.kind).toBe("recipient_unknown");
    expect(signal?.email).toBe("sarah@acme.example");
    expect(signal?.evidence).toMatch(/does not exist/i);
  });

  it("does not report the reporting system as the departed person", () => {
    const signal = detectDepartureSignal(
      {
        from: "postmaster@acme.example",
        subject: "Undeliverable: Q3 renewal",
        body: "Delivery to sarah@acme.example failed: 550 user unknown. Sent by postmaster@acme.example.",
      },
      SELF,
    );
    expect(signal?.email).toBe("sarah@acme.example");
  });

  it("does not report the user's own address", () => {
    const signal = detectDepartureSignal(
      {
        from: "mailer-daemon@myco.example",
        subject: "Delivery Status Notification (Failure)",
        body: "From: me@myco.example\nTo: sarah@acme.example\n550 5.1.1 user unknown",
      },
      SELF,
    );
    expect(signal?.email).toBe("sarah@acme.example");
  });
});

describe("transient failures are never departures", () => {
  // The expensive mistake: retiring a live contact because their server had a
  // bad afternoon.
  it("ignores a full mailbox", () => {
    expect(
      detectDepartureSignal(
        {
          from: "mailer-daemon@acme.example",
          subject: "Undeliverable",
          body: "sarah@acme.example: mailbox full, message not delivered.",
        },
        SELF,
      ),
    ).toBeNull();
  });

  it("ignores a 4.x temporary failure", () => {
    expect(
      detectDepartureSignal(
        {
          from: "mailer-daemon@acme.example",
          subject: "Delivery Status Notification (Delay)",
          body: "sarah@acme.example: 4.2.2 temporarily unavailable, will retry.",
        },
        SELF,
      ),
    ).toBeNull();
  });

  it("ignores a transient report even when it also carries permanent-sounding text", () => {
    // Real reports are verbose and quote boilerplate. The transient code wins.
    expect(
      detectDepartureSignal(
        {
          from: "mailer-daemon@acme.example",
          subject: "Undeliverable",
          body: "4.2.2 over quota. If this persists the address may not exist.",
        },
        SELF,
      ),
    ).toBeNull();
  });
});

describe("departure autoresponders", () => {
  it("reads an explicit 'no longer with' autoreply", () => {
    const signal = detectDepartureSignal(
      {
        from: "sarah@acme.example",
        subject: "Automatic reply: Q3 renewal",
        body: "Sarah is no longer with Acme. Please contact tom@acme.example for anything urgent.",
      },
      SELF,
    );
    expect(signal?.kind).toBe("left_organization");
    expect(signal?.evidence).toMatch(/no longer with/i);
  });

  it("reads a departure without any bounce framing", () => {
    // Not from a daemon and no delivery-report subject: the words alone carry it.
    const signal = detectDepartureSignal(
      {
        from: "sarah@acme.example",
        subject: "Out of office",
        body: "I have left the company as of 1 August.",
      },
      SELF,
    );
    expect(signal?.kind).toBe("left_organization");
  });
});

describe("ordinary mail is never a signal", () => {
  it("ignores a normal reply", () => {
    expect(
      detectDepartureSignal(
        { from: "sarah@acme.example", subject: "Re: Q3 renewal", body: "Looks good, let's talk Thursday." },
        SELF,
      ),
    ).toBeNull();
  });

  it("ignores a holiday out-of-office", () => {
    // Absence is not departure. This is the most common autoreply there is.
    expect(
      detectDepartureSignal(
        {
          from: "sarah@acme.example",
          subject: "Automatic reply: Q3 renewal",
          body: "I am out of the office until 14 August with limited access to email.",
        },
        SELF,
      ),
    ).toBeNull();
  });

  it("ignores someone discussing a departure in ordinary prose", () => {
    // A colleague mentioning that someone else left is not a delivery report
    // about the sender, and must not retire the sender.
    const signal = detectDepartureSignal(
      {
        from: "tom@acme.example",
        subject: "Re: intro",
        body: "Sarah has left the company, I am picking this up.",
      },
      SELF,
    );
    // It may read a signal, but it must never be attributed to Tom.
    expect(signal?.email).not.toBe("tom@acme.example");
  });

  it("ignores an empty message", () => {
    expect(detectDepartureSignal({}, SELF)).toBeNull();
  });
});
