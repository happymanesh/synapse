-- CreateTable
CREATE TABLE "company_master" (
    "cid" SERIAL NOT NULL,
    "company_code" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "pan_no" TEXT,
    "tan_no" TEXT,
    "regd_office_address" TEXT,
    "company_logo_file_location" TEXT,

    CONSTRAINT "company_master_pkey" PRIMARY KEY ("cid")
);

-- CreateTable
CREATE TABLE "hierarchy_master" (
    "uid" SERIAL NOT NULL,
    "hierarchy_code" TEXT NOT NULL,
    "hierarchy_name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "seq_id" TEXT NOT NULL,

    CONSTRAINT "hierarchy_master_pkey" PRIMARY KEY ("uid")
);

-- CreateTable
CREATE TABLE "client_category_master" (
    "client_category_code" TEXT NOT NULL,
    "client_category_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "client_category_master_pkey" PRIMARY KEY ("client_category_code")
);

-- CreateTable
CREATE TABLE "user_details" (
    "uid" SERIAL NOT NULL,
    "company_code" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "customer_id" TEXT,
    "full_name" TEXT NOT NULL,
    "mobile" TEXT,
    "email" TEXT,
    "last_password_changed_date" TIMESTAMP(3),
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_date" TIMESTAMP(3),
    "hierarchy_code" TEXT NOT NULL,
    "client_category_code" TEXT NOT NULL DEFAULT 'C00',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_details_pkey" PRIMARY KEY ("uid")
);

-- CreateTable
CREATE TABLE "password_history" (
    "id" SERIAL NOT NULL,
    "user_uid" INTEGER NOT NULL,
    "password_hash" TEXT NOT NULL,
    "changed_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_ip_mapping" (
    "id" SERIAL NOT NULL,
    "user_uid" INTEGER NOT NULL,
    "ip_mapping" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_ip_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_logs" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "user_uid" INTEGER,
    "login_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "failure_reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "login_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_master" (
    "menu_code" TEXT NOT NULL,
    "parent_menu_code" TEXT,
    "menu_name" TEXT NOT NULL,
    "icon" TEXT,
    "route_path" TEXT,
    "level" INTEGER NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "company_code" TEXT NOT NULL,
    "hierarchy_code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "menu_master_pkey" PRIMARY KEY ("menu_code")
);

-- CreateTable
CREATE TABLE "role_master" (
    "role_code" TEXT NOT NULL,
    "role_name" TEXT NOT NULL,
    "company_code" TEXT NOT NULL,
    "hierarchy_code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "role_master_pkey" PRIMARY KEY ("role_code")
);

-- CreateTable
CREATE TABLE "role_menu_map" (
    "id" SERIAL NOT NULL,
    "role_code" TEXT NOT NULL,
    "menu_code" TEXT NOT NULL,
    "company_code" TEXT NOT NULL,
    "hierarchy_code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "role_menu_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role_map" (
    "id" SERIAL NOT NULL,
    "user_uid" INTEGER NOT NULL,
    "role_code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_role_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_requests" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "request_type" TEXT NOT NULL,
    "contact" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_master_company_code_key" ON "company_master"("company_code");

-- CreateIndex
CREATE UNIQUE INDEX "hierarchy_master_hierarchy_code_key" ON "hierarchy_master"("hierarchy_code");

-- CreateIndex
CREATE UNIQUE INDEX "user_details_username_key" ON "user_details"("username");

-- CreateIndex
CREATE UNIQUE INDEX "role_menu_map_role_code_menu_code_company_code_hierarchy_co_key" ON "role_menu_map"("role_code", "menu_code", "company_code", "hierarchy_code");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_map_user_uid_role_code_key" ON "user_role_map"("user_uid", "role_code");

-- AddForeignKey
ALTER TABLE "user_details" ADD CONSTRAINT "user_details_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "company_master"("company_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_details" ADD CONSTRAINT "user_details_hierarchy_code_fkey" FOREIGN KEY ("hierarchy_code") REFERENCES "hierarchy_master"("hierarchy_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_details" ADD CONSTRAINT "user_details_client_category_code_fkey" FOREIGN KEY ("client_category_code") REFERENCES "client_category_master"("client_category_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_user_uid_fkey" FOREIGN KEY ("user_uid") REFERENCES "user_details"("uid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_ip_mapping" ADD CONSTRAINT "user_ip_mapping_user_uid_fkey" FOREIGN KEY ("user_uid") REFERENCES "user_details"("uid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_logs" ADD CONSTRAINT "login_logs_user_uid_fkey" FOREIGN KEY ("user_uid") REFERENCES "user_details"("uid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_master" ADD CONSTRAINT "menu_master_parent_menu_code_fkey" FOREIGN KEY ("parent_menu_code") REFERENCES "menu_master"("menu_code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_master" ADD CONSTRAINT "menu_master_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "company_master"("company_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_master" ADD CONSTRAINT "menu_master_hierarchy_code_fkey" FOREIGN KEY ("hierarchy_code") REFERENCES "hierarchy_master"("hierarchy_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_master" ADD CONSTRAINT "role_master_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "company_master"("company_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_master" ADD CONSTRAINT "role_master_hierarchy_code_fkey" FOREIGN KEY ("hierarchy_code") REFERENCES "hierarchy_master"("hierarchy_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_menu_map" ADD CONSTRAINT "role_menu_map_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "role_master"("role_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_menu_map" ADD CONSTRAINT "role_menu_map_menu_code_fkey" FOREIGN KEY ("menu_code") REFERENCES "menu_master"("menu_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_menu_map" ADD CONSTRAINT "role_menu_map_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "company_master"("company_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_menu_map" ADD CONSTRAINT "role_menu_map_hierarchy_code_fkey" FOREIGN KEY ("hierarchy_code") REFERENCES "hierarchy_master"("hierarchy_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_map" ADD CONSTRAINT "user_role_map_user_uid_fkey" FOREIGN KEY ("user_uid") REFERENCES "user_details"("uid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_map" ADD CONSTRAINT "user_role_map_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "role_master"("role_code") ON DELETE RESTRICT ON UPDATE CASCADE;
