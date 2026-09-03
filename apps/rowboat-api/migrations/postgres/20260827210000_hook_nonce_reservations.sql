-- Cross-replica replay protection for authenticated internal consent hooks.
CREATE TABLE "hook_nonce_reservations" (
  "nonce" character varying NOT NULL,
  "expires_at" timestamptz NOT NULL,
  PRIMARY KEY ("nonce")
);

CREATE INDEX "hook_nonce_reservations_expires_at" ON "hook_nonce_reservations" ("expires_at");
