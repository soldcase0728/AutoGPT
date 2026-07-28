-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'FACILITY_ADMIN', 'HEAD_COACH', 'ASSISTANT_COACH', 'TRAINER', 'STRENGTH_COACH', 'FACILITIES', 'FINANCE', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CONTEST', 'TEAM_PRACTICE', 'TEAM_OFFSEASON', 'SCHOOL_CAMP', 'PRIVATE_INSTRUCTION', 'CLUB_TRAVEL', 'SCHOOL_EVENT', 'EXTERNAL_RENTAL', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'AWAITING_DOCUMENTS', 'AWAITING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'DENIED', 'EXPIRED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "TeamLevel" AS ENUM ('VARSITY', 'JV', 'FRESHMAN', 'MIDDLE_SCHOOL', 'NONE');

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('INTERNAL', 'CLUB', 'NONPROFIT', 'COMMERCIAL', 'PARISH');

-- CreateEnum
CREATE TYPE "RateTier" AS ENUM ('INTERNAL', 'OLSM_AFFILIATED_CLUB', 'PARISH_PARTNER', 'NONPROFIT', 'COMMERCIAL');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('ANNUAL_COACH_AGREEMENT', 'FACILITY_USE_AGREEMENT', 'LIABILITY_WAIVER', 'CAMP_ADDENDUM', 'MINOR_PARTICIPANT_WAIVER', 'CERTIFICATE_OF_INSURANCE');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('NOT_STARTED', 'SENT', 'VIEWED', 'SIGNED', 'DECLINED', 'VOIDED', 'EXPIRED', 'UPLOADED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOID', 'UNCOLLECTIBLE');

-- CreateEnum
CREATE TYPE "CalendarSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "SeasonCode" AS ENUM ('FALL', 'WINTER', 'SPRING', 'SUMMER');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "sms_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "role" "Role" NOT NULL,
    "google_sub" TEXT,
    "password_hash" TEXT,
    "email_verified_at" TIMESTAMPTZ(3),
    "facility_scope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "organization_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "rate_tier" "RateTier" NOT NULL,
    "contact_user_id" TEXT,
    "stripe_customer_id" TEXT,
    "coi_document_id" TEXT,
    "coi_expires_at" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sports" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "season_code" "SeasonCode" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sport_id" TEXT NOT NULL,
    "team_level" "TeamLevel" NOT NULL DEFAULT 'VARSITY',
    "is_head" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "coach_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facilities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "indoor" BOOLEAN NOT NULL,
    "capacity" INTEGER NOT NULL,
    "requires_supervision" BOOLEAN NOT NULL DEFAULT false,
    "supervision_roles" "Role"[] DEFAULT ARRAY[]::"Role"[],
    "default_hours" JSONB NOT NULL,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "externally_bookable" BOOLEAN NOT NULL DEFAULT false,
    "weather_dependent" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "photo_url" TEXT,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "google_calendar_id" TEXT,
    "google_channel_id" TEXT,
    "google_resource_id" TEXT,
    "google_channel_expiry" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_spaces" (
    "id" TEXT NOT NULL,
    "facility_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "blocks_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "buffer_minutes" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sub_spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sport_id" TEXT,
    "season_code" "SeasonCode" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "mhsaa_season_code" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standing_blocks" (
    "id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,
    "sport_id" TEXT NOT NULL,
    "sub_space_id" TEXT NOT NULL,
    "team_level" "TeamLevel" NOT NULL DEFAULT 'VARSITY',
    "rrule" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "standing_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "sub_space_id" TEXT NOT NULL,
    "sport_id" TEXT,
    "season_id" TEXT,
    "standing_block_id" TEXT,
    "activity_type" "ActivityType" NOT NULL,
    "team_level" "TeamLevel" NOT NULL DEFAULT 'NONE',
    "title" TEXT NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "headcount" INTEGER NOT NULL DEFAULT 0,
    "status" "BookingStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL,
    "parent_booking_id" TEXT,
    "setup_notes" TEXT,
    "equipment_notes" TEXT,
    "supervisor_id" TEXT,
    "hold_expires_at" TIMESTAMPTZ(3),
    "google_event_id" TEXT,
    "google_calendar_id" TEXT,
    "calendar_sync_status" "CalendarSyncStatus",
    "calendar_sync_error" TEXT,
    "calendar_sync_version" INTEGER NOT NULL DEFAULT 0,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "bumped_by_booking_id" TEXT,
    "checked_in_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_occupancy" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "sub_space_id" TEXT NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "time_range" tstzrange,

    CONSTRAINT "booking_occupancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_requirements" (
    "booking_id" TEXT NOT NULL,
    "requires_admin_approval" BOOLEAN NOT NULL,
    "requires_head_coach_approval" BOOLEAN NOT NULL,
    "requires_contract" BOOLEAN NOT NULL,
    "requires_waiver" BOOLEAN NOT NULL,
    "requires_coi" BOOLEAN NOT NULL,
    "requires_payment" BOOLEAN NOT NULL,
    "auto_approve" BOOLEAN NOT NULL,
    "rule_snapshot" JSONB NOT NULL,

    CONSTRAINT "booking_requirements_pkey" PRIMARY KEY ("booking_id")
);

-- CreateTable
CREATE TABLE "approval_steps" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "approver_id" TEXT,
    "required_role" "Role",
    "required_user_id" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decided_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT,
    "user_id" TEXT,
    "organization_id" TEXT,
    "type" "DocumentType" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "envelope_id" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "signer_email" TEXT,
    "signer_name" TEXT,
    "signed_at" TIMESTAMPTZ(3),
    "file_url" TEXT,
    "expires_at" TIMESTAMPTZ(3),
    "public_token" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "line_items" JSONB NOT NULL,
    "subtotal_cents" INTEGER NOT NULL,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "deposit_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "stripe_session_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "deposit_intent_id" TEXT,
    "due_at" TIMESTAMPTZ(3),
    "issued_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_cards" (
    "id" TEXT NOT NULL,
    "facility_id" TEXT NOT NULL,
    "activity_type" "ActivityType" NOT NULL,
    "rate_tier" "RateTier" NOT NULL,
    "hourly_cents" INTEGER NOT NULL,
    "flat_day_cents" INTEGER,
    "min_hours" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "deposit_cents" INTEGER NOT NULL DEFAULT 0,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "effective_to" TIMESTAMPTZ(3),

    CONSTRAINT "rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surcharges" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "surcharges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "activity_type" "ActivityType" NOT NULL,
    "requester_role" "Role",
    "requires_admin_approval" BOOLEAN NOT NULL DEFAULT true,
    "requires_head_coach_approval" BOOLEAN NOT NULL DEFAULT false,
    "requires_contract" BOOLEAN NOT NULL DEFAULT false,
    "requires_waiver" BOOLEAN NOT NULL DEFAULT false,
    "requires_coi" BOOLEAN NOT NULL DEFAULT false,
    "requires_payment" BOOLEAN NOT NULL DEFAULT false,
    "auto_approve" BOOLEAN NOT NULL DEFAULT false,
    "notify_admin" BOOLEAN NOT NULL DEFAULT false,
    "priority_rank" INTEGER NOT NULL,
    "document_hold_hours" INTEGER NOT NULL DEFAULT 72,
    "payment_hold_hours" INTEGER NOT NULL DEFAULT 120,
    "refund_full_days" INTEGER NOT NULL DEFAULT 14,
    "refund_partial_days" INTEGER NOT NULL DEFAULT 3,
    "refund_partial_percent" INTEGER NOT NULL DEFAULT 50,
    "mhsaa_compliance_flag" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blackouts" (
    "id" TEXT NOT NULL,
    "facility_id" TEXT,
    "sub_space_id" TEXT,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blackouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" TEXT NOT NULL,
    "sub_space_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "window_end" TIMESTAMPTZ(3) NOT NULL,
    "activity_type" "ActivityType" NOT NULL,
    "notified_at" TIMESTAMPTZ(3),
    "fulfilled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_label" TEXT,
    "action" TEXT NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT,
    "reason" TEXT,
    "payload" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_queue" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "run_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 6,
    "locked_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");

-- CreateIndex
CREATE INDEX "users_role_active_idx" ON "users"("role", "active");

-- CreateIndex
CREATE INDEX "organizations_coi_expires_at_idx" ON "organizations"("coi_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "sports_name_key" ON "sports"("name");

-- CreateIndex
CREATE INDEX "coach_assignments_sport_id_is_head_idx" ON "coach_assignments"("sport_id", "is_head");

-- CreateIndex
CREATE UNIQUE INDEX "coach_assignments_user_id_sport_id_team_level_key" ON "coach_assignments"("user_id", "sport_id", "team_level");

-- CreateIndex
CREATE UNIQUE INDEX "facilities_name_key" ON "facilities"("name");

-- CreateIndex
CREATE UNIQUE INDEX "facilities_slug_key" ON "facilities"("slug");

-- CreateIndex
CREATE INDEX "sub_spaces_facility_id_active_idx" ON "sub_spaces"("facility_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "sub_spaces_facility_id_slug_key" ON "sub_spaces"("facility_id", "slug");

-- CreateIndex
CREATE INDEX "seasons_season_code_start_date_idx" ON "seasons"("season_code", "start_date");

-- CreateIndex
CREATE INDEX "standing_blocks_season_id_published_idx" ON "standing_blocks"("season_id", "published");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_reference_key" ON "bookings"("reference");

-- CreateIndex
CREATE INDEX "bookings_sub_space_id_start_at_idx" ON "bookings"("sub_space_id", "start_at");

-- CreateIndex
CREATE INDEX "bookings_status_start_at_idx" ON "bookings"("status", "start_at");

-- CreateIndex
CREATE INDEX "bookings_requester_id_start_at_idx" ON "bookings"("requester_id", "start_at");

-- CreateIndex
CREATE INDEX "bookings_hold_expires_at_idx" ON "bookings"("hold_expires_at");

-- CreateIndex
CREATE INDEX "booking_occupancy_sub_space_id_start_at_idx" ON "booking_occupancy"("sub_space_id", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_occupancy_booking_id_sub_space_id_key" ON "booking_occupancy"("booking_id", "sub_space_id");

-- CreateIndex
CREATE INDEX "approval_steps_status_required_role_idx" ON "approval_steps"("status", "required_role");

-- CreateIndex
CREATE UNIQUE INDEX "documents_public_token_key" ON "documents"("public_token");

-- CreateIndex
CREATE INDEX "documents_user_id_type_status_idx" ON "documents"("user_id", "type", "status");

-- CreateIndex
CREATE INDEX "documents_booking_id_type_idx" ON "documents"("booking_id", "type");

-- CreateIndex
CREATE INDEX "documents_expires_at_idx" ON "documents"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_status_due_at_idx" ON "invoices"("status", "due_at");

-- CreateIndex
CREATE INDEX "rate_cards_facility_id_activity_type_rate_tier_idx" ON "rate_cards"("facility_id", "activity_type", "rate_tier");

-- CreateIndex
CREATE UNIQUE INDEX "surcharges_code_key" ON "surcharges"("code");

-- CreateIndex
CREATE UNIQUE INDEX "rules_activity_type_requester_role_key" ON "rules"("activity_type", "requester_role");

-- CreateIndex
CREATE INDEX "blackouts_start_at_end_at_idx" ON "blackouts"("start_at", "end_at");

-- CreateIndex
CREATE INDEX "waitlist_entries_sub_space_id_window_start_idx" ON "waitlist_entries"("sub_space_id", "window_start");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_created_at_idx" ON "audit_log"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_queue_idempotency_key_key" ON "job_queue"("idempotency_key");

-- CreateIndex
CREATE INDEX "job_queue_completed_at_run_at_idx" ON "job_queue"("completed_at", "run_at");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_assignments" ADD CONSTRAINT "coach_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_assignments" ADD CONSTRAINT "coach_assignments_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_spaces" ADD CONSTRAINT "sub_spaces_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_blocks" ADD CONSTRAINT "standing_blocks_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_blocks" ADD CONSTRAINT "standing_blocks_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_blocks" ADD CONSTRAINT "standing_blocks_sub_space_id_fkey" FOREIGN KEY ("sub_space_id") REFERENCES "sub_spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_blocks" ADD CONSTRAINT "standing_blocks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_sub_space_id_fkey" FOREIGN KEY ("sub_space_id") REFERENCES "sub_spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_standing_block_id_fkey" FOREIGN KEY ("standing_block_id") REFERENCES "standing_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_parent_booking_id_fkey" FOREIGN KEY ("parent_booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_occupancy" ADD CONSTRAINT "booking_occupancy_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_occupancy" ADD CONSTRAINT "booking_occupancy_sub_space_id_fkey" FOREIGN KEY ("sub_space_id") REFERENCES "sub_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_requirements" ADD CONSTRAINT "booking_requirements_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blackouts" ADD CONSTRAINT "blackouts_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blackouts" ADD CONSTRAINT "blackouts_sub_space_id_fkey" FOREIGN KEY ("sub_space_id") REFERENCES "sub_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_sub_space_id_fkey" FOREIGN KEY ("sub_space_id") REFERENCES "sub_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
