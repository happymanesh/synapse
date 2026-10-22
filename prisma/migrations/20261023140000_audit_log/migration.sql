CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_uid" INTEGER,
    "actor_username" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "record_id" TEXT,
    "changes" JSONB,
    "ip_address" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log"("occurred_at");
CREATE INDEX "audit_log_model_occurred_at_idx" ON "audit_log"("model", "occurred_at");
CREATE INDEX "audit_log_actor_uid_occurred_at_idx" ON "audit_log"("actor_uid", "occurred_at");

-- No FK to user_details on purpose: an audit row must survive the deletion of the user it
-- refers to, which is exactly the case someone will later need to investigate.
