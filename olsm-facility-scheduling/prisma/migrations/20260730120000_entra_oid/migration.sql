-- Microsoft Entra ID object id.
--
-- Immutable per user within the tenant, so it survives a rename or an address
-- change in a way the email address does not. Nullable: accounts predating SSO,
-- and every external renter, will never have one. Unique so two local accounts
-- cannot claim the same Entra identity.
ALTER TABLE "users" ADD COLUMN "entra_oid" TEXT;

CREATE UNIQUE INDEX "users_entra_oid_key" ON "users"("entra_oid");
