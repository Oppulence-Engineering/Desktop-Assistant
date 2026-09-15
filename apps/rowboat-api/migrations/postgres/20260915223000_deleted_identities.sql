-- Tombstones for deleted accounts. A WorkOS access token issued before the
-- deletion stays valid until it expires; the API checks this table so the
-- token cannot create the account again. key_hash is a SHA-256 hash of the
-- WorkOS user id, so the table holds no personal data.
CREATE TABLE "deleted_identities" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "key_hash" character varying NOT NULL,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "deletedidentity_key_hash" ON "deleted_identities" ("key_hash");
