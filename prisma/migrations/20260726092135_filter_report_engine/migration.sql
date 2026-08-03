-- AlterTable
ALTER TABLE "menu_master" ADD COLUMN     "external_url" TEXT,
ADD COLUMN     "menu_type" TEXT NOT NULL DEFAULT 'ROUTE',
ADD COLUMN     "report_id" TEXT;

-- CreateTable
CREATE TABLE "filter_component_master" (
    "component_code" TEXT NOT NULL,
    "component_name" TEXT NOT NULL,
    "component_type" TEXT NOT NULL,
    "data_source_type" TEXT NOT NULL DEFAULT 'NONE',
    "static_options_json" TEXT,
    "data_source_query" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "filter_component_master_pkey" PRIMARY KEY ("component_code")
);

-- CreateTable
CREATE TABLE "filter_definition" (
    "filter_id" TEXT NOT NULL,
    "filter_name" TEXT NOT NULL,
    "is_collapsible" BOOLEAN NOT NULL DEFAULT true,
    "default_collapsed" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "filter_definition_pkey" PRIMARY KEY ("filter_id")
);

-- CreateTable
CREATE TABLE "filter_definition_item" (
    "id" SERIAL NOT NULL,
    "filter_id" TEXT NOT NULL,
    "component_code" TEXT NOT NULL,
    "row_no" INTEGER NOT NULL,
    "position_no" INTEGER NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "label_override" TEXT,
    "default_value" TEXT,
    "mapped_column" TEXT,
    "depends_on_item_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "filter_definition_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_definition" (
    "report_id" TEXT NOT NULL,
    "report_title" TEXT NOT NULL,
    "filter_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'REPORT',
    "query_text" TEXT NOT NULL,
    "target_table" TEXT,
    "max_rows" INTEGER NOT NULL DEFAULT 2000,
    "freeze_columns" INTEGER NOT NULL DEFAULT 0,
    "display_style" TEXT NOT NULL DEFAULT 'PAGED',
    "footer_note" TEXT,
    "allowed_formats" TEXT[] DEFAULT ARRAY['CSV']::TEXT[],
    "allowed_deliveries" TEXT[] DEFAULT ARRAY['DOWNLOAD']::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "report_definition_pkey" PRIMARY KEY ("report_id")
);

-- CreateTable
CREATE TABLE "report_column" (
    "id" SERIAL NOT NULL,
    "report_id" TEXT NOT NULL,
    "column_key" TEXT NOT NULL,
    "display_label" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_highlighted" BOOLEAN NOT NULL DEFAULT false,
    "is_identifier" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "report_column_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_row_highlight_rule" (
    "id" SERIAL NOT NULL,
    "report_id" TEXT NOT NULL,
    "column_key" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "compare_value" TEXT NOT NULL,
    "highlight_color" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "report_row_highlight_rule_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "menu_master" ADD CONSTRAINT "menu_master_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "report_definition"("report_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filter_definition_item" ADD CONSTRAINT "filter_definition_item_filter_id_fkey" FOREIGN KEY ("filter_id") REFERENCES "filter_definition"("filter_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filter_definition_item" ADD CONSTRAINT "filter_definition_item_component_code_fkey" FOREIGN KEY ("component_code") REFERENCES "filter_component_master"("component_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filter_definition_item" ADD CONSTRAINT "filter_definition_item_depends_on_item_id_fkey" FOREIGN KEY ("depends_on_item_id") REFERENCES "filter_definition_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_definition" ADD CONSTRAINT "report_definition_filter_id_fkey" FOREIGN KEY ("filter_id") REFERENCES "filter_definition"("filter_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_column" ADD CONSTRAINT "report_column_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "report_definition"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_row_highlight_rule" ADD CONSTRAINT "report_row_highlight_rule_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "report_definition"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;
