-- CreateTable
CREATE TABLE "app_master" (
    "app_code" TEXT NOT NULL,
    "app_name" TEXT NOT NULL,
    "company_code" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "app_logo_url" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "app_master_pkey" PRIMARY KEY ("app_code")
);

-- AddForeignKey
ALTER TABLE "app_master" ADD CONSTRAINT "app_master_company_code_fkey"
    FOREIGN KEY ("company_code") REFERENCES "company_master"("company_code")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: menus map to an app; NULL = global (shown in every app)
ALTER TABLE "menu_master" ADD COLUMN "app_code" TEXT;

ALTER TABLE "menu_master" ADD CONSTRAINT "menu_master_app_code_fkey"
    FOREIGN KEY ("app_code") REFERENCES "app_master"("app_code")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: remember the last app a user opened
ALTER TABLE "user_details" ADD COLUMN "last_app_code" TEXT;
