import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * Password for the seeded accounts. Kept OUT of source control — set SEED_USER_PASSWORD in
 * .env (which is gitignored) to control it. The fallback is an obvious placeholder rather
 * than a usable secret, so a repo clone can never contain a real working credential.
 * It still satisfies the password policy in src/lib/password-policy.ts.
 */
const SEED_PASSWORD = process.env.SEED_USER_PASSWORD ?? "ChangeMe@2026";

const HIERARCHIES: { seqId: string; name: string; description: string }[] = [
  { seqId: "0000", name: "Management", description: "Company management" },
  { seqId: "0100", name: "CSO", description: "Chief Sales Officer / CSO team" },
  { seqId: "0200", name: "Employee", description: "Internal employees" },
  { seqId: "0300", name: "Branch", description: "Branch staff" },
  { seqId: "0400", name: "Franchisee", description: "Franchisee partners" },
  { seqId: "0500", name: "SubBroker", description: "Sub-broker partners" },
  { seqId: "0600", name: "Remisior", description: "Remisier partners" },
  { seqId: "0700", name: "Family", description: "Family accounts" },
  { seqId: "0800", name: "Client", description: "Clients" },
];

async function main() {
  // Company Master — 'SIHL' is a placeholder company code; the BRD's sample
  // user_details row didn't include one, confirm/replace with the real code.
  await prisma.companyMaster.upsert({
    where: { companyCode: "SIHL" },
    update: { companyLogoFileLocation: "/logos/sihl-logo.png" },
    create: {
      companyCode: "SIHL",
      companyName: "Shah Investor's Home Limited",
      companyLogoFileLocation: "/logos/sihl-logo.png",
      isActive: true,
    },
  });

  for (const h of HIERARCHIES) {
    await prisma.hierarchyMaster.upsert({
      where: { hierarchyCode: h.seqId },
      update: {},
      create: {
        hierarchyCode: h.seqId,
        hierarchyName: h.name,
        description: h.description,
        seqId: h.seqId,
        isActive: true,
      },
    });
  }

  await prisma.clientCategoryMaster.upsert({
    where: { clientCategoryCode: "C00" },
    update: {},
    create: { clientCategoryCode: "C00", clientCategoryName: "All Client", isActive: true },
  });
  await prisma.clientCategoryMaster.upsert({
    where: { clientCategoryCode: "C01" },
    update: {},
    create: { clientCategoryCode: "C01", clientCategoryName: "B2B Client", isActive: true },
  });

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  const user = await prisma.userDetails.upsert({
    where: { username: "Manesh001" },
    update: {},
    create: {
      companyCode: "SIHL",
      username: "Manesh001",
      passwordHash,
      customerId: "Manesh001",
      fullName: "Manesh Anand Mukherjee",
      mobile: "9892953949",
      email: "happymanesh@gmail.com",
      lastPasswordChangedDate: new Date("1900-01-01"),
      createdDate: new Date("2026-07-25"),
      hierarchyCode: "0100",
      clientCategoryCode: "C00",
      isActive: true,
    },
  });

  const existingHistory = await prisma.passwordHistory.findFirst({ where: { userUid: user.uid } });
  if (!existingHistory) {
    await prisma.passwordHistory.create({ data: { userUid: user.uid, passwordHash } });
  }

  // --- Super admin: hierarchy 9999, user Admin001, ADMIN role + menus + mappings ---

  await prisma.hierarchyMaster.upsert({
    where: { hierarchyCode: "9999" },
    update: {},
    create: {
      hierarchyCode: "9999",
      hierarchyName: "Admin",
      description: "Super administrator tier — manages master data and access",
      seqId: "9999",
      isActive: true,
    },
  });

  const adminPasswordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  const adminUser = await prisma.userDetails.upsert({
    where: { username: "Admin001" },
    update: {},
    create: {
      companyCode: "SIHL",
      username: "Admin001",
      passwordHash: adminPasswordHash,
      customerId: "Admin001",
      fullName: "Manesh Anand Mukherjee",
      mobile: "9892953949",
      email: "happymanesh@gmail.com",
      lastPasswordChangedDate: new Date("1900-01-01"),
      createdDate: new Date("2026-07-25"),
      hierarchyCode: "9999",
      clientCategoryCode: "C00",
      isActive: true,
    },
  });

  const existingAdminHistory = await prisma.passwordHistory.findFirst({ where: { userUid: adminUser.uid } });
  if (!existingAdminHistory) {
    await prisma.passwordHistory.create({ data: { userUid: adminUser.uid, passwordHash: adminPasswordHash } });
  }

  await prisma.roleMaster.upsert({
    where: { roleCode: "ADMIN" },
    update: {},
    create: {
      roleCode: "ADMIN",
      roleName: "Super Admin",
      companyCode: "SIHL",
      hierarchyCode: "9999",
      isActive: true,
    },
  });

  // Two sample apps so the app switcher is meaningful out of the box. Administration
  // menus deliberately keep appCode = null (global) — scoping them to one app would let
  // an admin switch app and lose access to App Master itself.
  const APPS = [
    { appCode: "BROKING", appName: "Broking", icon: "📈", displayOrder: 1, description: "Trading, reports and client servicing." },
    { appCode: "BACKOFFICE", appName: "Back Office", icon: "🧾", displayOrder: 2, description: "Settlement, accounting and reconciliation." },
  ];
  for (const a of APPS) {
    await prisma.appMaster.upsert({
      where: { appCode: a.appCode },
      update: { appName: a.appName, icon: a.icon, displayOrder: a.displayOrder, description: a.description, isActive: true },
      create: { ...a, companyCode: "SIHL", isActive: true },
    });
  }

  const ADMIN_MENUS: {
    code: string;
    parent: string | null;
    name: string;
    icon: string;
    route: string | null;
    level: number;
    order: number;
  }[] = [
    { code: "ADMIN_ROOT", parent: null, name: "Administration", icon: "🛠️", route: null, level: 1, order: 900 },
    { code: "ADMIN_COMPANY", parent: "ADMIN_ROOT", name: "Company", icon: "🏢", route: "/admin/companies", level: 2, order: 1 },
    { code: "ADMIN_APPS", parent: "ADMIN_ROOT", name: "App", icon: "🧩", route: "/admin/apps", level: 2, order: 2 },
    { code: "ADMIN_HIERARCHY", parent: "ADMIN_ROOT", name: "Hierarchy", icon: "🗂️", route: "/admin/hierarchies", level: 2, order: 3 },
    {
      code: "ADMIN_CLIENT_CATEGORY",
      parent: "ADMIN_ROOT",
      name: "Client Category",
      icon: "🏷️",
      route: "/admin/client-categories",
      level: 2,
      order: 4,
    },
    {
      code: "ADMIN_IP_MAPPING",
      parent: "ADMIN_ROOT",
      name: "User IP Mapping",
      icon: "🌐",
      route: "/admin/ip-mappings",
      level: 2,
      order: 5,
    },
    { code: "ADMIN_MENU", parent: "ADMIN_ROOT", name: "Menu", icon: "📋", route: "/admin/menus", level: 2, order: 6 },
    { code: "ADMIN_ROLE", parent: "ADMIN_ROOT", name: "Role", icon: "🔑", route: "/admin/roles", level: 2, order: 7 },
    { code: "ADMIN_USER", parent: "ADMIN_ROOT", name: "User", icon: "👤", route: "/admin/users", level: 2, order: 8 },
    {
      code: "ADMIN_FILTER_COMPONENTS",
      parent: "ADMIN_ROOT",
      name: "Filter Components",
      icon: "🧩",
      route: "/admin/filter-components",
      level: 2,
      order: 9,
    },
    { code: "ADMIN_FILTERS", parent: "ADMIN_ROOT", name: "Filters", icon: "🧮", route: "/admin/filters", level: 2, order: 10 },
    { code: "ADMIN_REPORTS", parent: "ADMIN_ROOT", name: "Reports", icon: "📈", route: "/admin/reports", level: 2, order: 11 },
    {
      code: "ADMIN_NOTIFICATIONS",
      parent: "ADMIN_ROOT",
      name: "Notifications",
      icon: "📣",
      route: "/admin/notifications",
      level: 2,
      order: 12,
    },
  ];

  for (const m of ADMIN_MENUS) {
    await prisma.menuMaster.upsert({
      where: { menuCode: m.code },
      update: {},
      create: {
        menuCode: m.code,
        parentMenuCode: m.parent,
        menuName: m.name,
        icon: m.icon,
        routePath: m.route,
        level: m.level,
        displayOrder: m.order,
        companyCode: "SIHL",
        hierarchyCode: "9999",
        isActive: true,
      },
    });

    await prisma.roleMenuMap.upsert({
      where: {
        roleCode_menuCode_companyCode_hierarchyCode: {
          roleCode: "ADMIN",
          menuCode: m.code,
          companyCode: "SIHL",
          hierarchyCode: "9999",
        },
      },
      update: {},
      create: { roleCode: "ADMIN", menuCode: m.code, companyCode: "SIHL", hierarchyCode: "9999", isActive: true },
    });
  }

  await prisma.userRoleMap.upsert({
    where: { userUid_roleCode: { userUid: adminUser.uid, roleCode: "ADMIN" } },
    update: {},
    create: { userUid: adminUser.uid, roleCode: "ADMIN", isActive: true },
  });

  // --- Sample: "Sales Report" — a worked example of the dynamic filter/report
  // engine. sample_sales is a plain, hand-created reporting table (the engine is
  // designed to work against arbitrary tables like this, not just Prisma models).

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS sample_sales (
      id SERIAL PRIMARY KEY,
      company_code TEXT NOT NULL,
      sale_date DATE NOT NULL,
      product_name TEXT NOT NULL,
      region TEXT NOT NULL,
      quantity INT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      updated_on TIMESTAMP
    )
  `);

  // Existing databases predate the FORM-mode entry screen, which needs the ownership
  // columns from the CLAUDE.md "user-owned records" rule. The originally seeded demo
  // rows keep created_by = NULL on purpose: they're report fixtures owned by nobody,
  // so they never show up in a user's own add/edit list.
  for (const col of ["created_by TEXT", "updated_by TEXT", "updated_on TIMESTAMP"]) {
    await prisma.$executeRawUnsafe(`ALTER TABLE sample_sales ADD COLUMN IF NOT EXISTS ${col}`);
  }

  const existingSales = await prisma.$queryRawUnsafe<{ count: number }[]>(
    "SELECT COUNT(*)::int AS count FROM sample_sales"
  );
  if ((existingSales[0]?.count ?? 0) === 0) {
    const products = ["Equity Delivery", "Equity Intraday", "F&O", "Mutual Fund SIP", "IPO Application", "ETF"];
    const regions = ["West", "North", "South", "East"];
    const today = new Date();

    for (let monthsAgo = 5; monthsAgo >= 0; monthsAgo--) {
      for (let i = 0; i < 5; i++) {
        const saleDate = new Date(today.getFullYear(), today.getMonth() - monthsAgo, 3 + i * 5);
        const product = products[(monthsAgo + i) % products.length];
        const region = regions[(monthsAgo * 2 + i) % regions.length];
        const quantity = 5 + ((monthsAgo + i * 3) % 20);
        const amount = 15000 + ((monthsAgo * 4173 + i * 2917) % 85000);

        await prisma.$executeRawUnsafe(
          `INSERT INTO sample_sales (company_code, sale_date, product_name, region, quantity, amount) VALUES ($1, $2, $3, $4, $5, $6)`,
          "SIHL",
          saleDate,
          product,
          region,
          quantity,
          amount
        );
      }
    }
  }

  await prisma.filterComponentMaster.createMany({
    data: [
      {
        componentCode: "SALES_COMPANY",
        componentName: "Company",
        componentType: "DROPDOWN",
        dataSourceType: "SQL",
        dataSourceQuery: "SELECT company_code as value, company_name as label FROM company_master WHERE is_active = true ORDER BY company_name",
      },
      { componentCode: "SALES_DATE_RANGE", componentName: "Sale Date Range", componentType: "DATE_RANGE", dataSourceType: "NONE" },
      {
        componentCode: "SALES_SUMMARY_TYPE",
        componentName: "Report Type",
        componentType: "DROPDOWN",
        dataSourceType: "STATIC",
        staticOptionsJson: JSON.stringify([
          { value: "PRODUCT", label: "Productwise" },
          { value: "REGION", label: "Regionwise" },
        ]),
      },
      {
        componentCode: "SALES_DETAIL_PRODUCT",
        componentName: "Product",
        componentType: "DROPDOWN",
        dataSourceType: "SQL",
        dataSourceQuery: "SELECT DISTINCT product_name AS value, product_name AS label FROM sample_sales ORDER BY product_name",
      },
      { componentCode: "SALES_ENTRY_DATE", componentName: "Sale Date", componentType: "DATE", dataSourceType: "NONE" },
      { componentCode: "SALES_ENTRY_QUANTITY", componentName: "Quantity", componentType: "NUMBER", dataSourceType: "NONE" },
      { componentCode: "SALES_ENTRY_AMOUNT", componentName: "Amount", componentType: "NUMBER", dataSourceType: "NONE" },
      {
        componentCode: "SALES_ENTRY_PRODUCT",
        componentName: "Product",
        componentType: "DROPDOWN",
        dataSourceType: "STATIC",
        staticOptionsJson: JSON.stringify(
          ["Equity Delivery", "Equity Intraday", "F&O", "Mutual Fund SIP", "IPO Application", "ETF"].map((p) => ({
            value: p,
            label: p,
          }))
        ),
      },
      {
        componentCode: "SALES_ENTRY_REGION",
        componentName: "Region",
        componentType: "DROPDOWN",
        dataSourceType: "STATIC",
        staticOptionsJson: JSON.stringify(["West", "North", "South", "East"].map((r) => ({ value: r, label: r }))),
      },
      {
        componentCode: "SALES_DETAIL_REGION",
        componentName: "Region",
        componentType: "DROPDOWN",
        dataSourceType: "SQL",
        dataSourceQuery: "SELECT DISTINCT region AS value, region AS label FROM sample_sales ORDER BY region",
      },
    ],
    skipDuplicates: true,
  });

  await prisma.filterDefinition.upsert({
    where: { filterId: "SALES_REPORT_FILTER" },
    update: {},
    create: { filterId: "SALES_REPORT_FILTER", filterName: "Sales Report Filter", isCollapsible: true, defaultCollapsed: false },
  });

  const existingSalesFilterItems = await prisma.filterDefinitionItem.findMany({ where: { filterId: "SALES_REPORT_FILTER" } });
  if (existingSalesFilterItems.length === 0) {
    await prisma.filterDefinitionItem.create({
      data: { filterId: "SALES_REPORT_FILTER", componentCode: "SALES_COMPANY", rowNo: 1, positionNo: 1 },
    });
    await prisma.filterDefinitionItem.create({
      data: { filterId: "SALES_REPORT_FILTER", componentCode: "SALES_DATE_RANGE", rowNo: 1, positionNo: 2 },
    });
  }

  // Sales Summary's filter: Productwise/Regionwise is mandatory, Company + Date
  // Range are the same reusable components as Sales Report — reusing the same
  // componentCode is what lets the drill-down's automatic filter carry-over work
  // (the detail report's filter recognizes these same codes without any explicit
  // mapping). See CLAUDE.md "Report drill-down" rule.
  await prisma.filterDefinition.upsert({
    where: { filterId: "SALES_SUMMARY_FILTER" },
    update: {},
    create: { filterId: "SALES_SUMMARY_FILTER", filterName: "Sales Summary Filter", isCollapsible: true, defaultCollapsed: false },
  });
  const existingSummaryFilterItems = await prisma.filterDefinitionItem.findMany({ where: { filterId: "SALES_SUMMARY_FILTER" } });
  if (existingSummaryFilterItems.length === 0) {
    await prisma.filterDefinitionItem.create({
      data: { filterId: "SALES_SUMMARY_FILTER", componentCode: "SALES_SUMMARY_TYPE", rowNo: 1, positionNo: 1, isMandatory: true },
    });
    await prisma.filterDefinitionItem.create({
      data: { filterId: "SALES_SUMMARY_FILTER", componentCode: "SALES_COMPANY", rowNo: 1, positionNo: 2 },
    });
    await prisma.filterDefinitionItem.create({
      data: { filterId: "SALES_SUMMARY_FILTER", componentCode: "SALES_DATE_RANGE", rowNo: 1, positionNo: 3 },
    });
  }

  // Sales Detail's filter: Company + Date Range (same components/codes as Sales
  // Report/Summary, for carry-over) plus optional Product/Region — populated by
  // the drill-down click, but also directly usable on their own.
  await prisma.filterDefinition.upsert({
    where: { filterId: "SALES_DETAIL_FILTER" },
    update: {},
    create: { filterId: "SALES_DETAIL_FILTER", filterName: "Sales Detail Filter", isCollapsible: true, defaultCollapsed: false },
  });
  const existingDetailFilterItems = await prisma.filterDefinitionItem.findMany({ where: { filterId: "SALES_DETAIL_FILTER" } });
  if (existingDetailFilterItems.length === 0) {
    await prisma.filterDefinitionItem.create({
      data: { filterId: "SALES_DETAIL_FILTER", componentCode: "SALES_COMPANY", rowNo: 1, positionNo: 1 },
    });
    await prisma.filterDefinitionItem.create({
      data: { filterId: "SALES_DETAIL_FILTER", componentCode: "SALES_DATE_RANGE", rowNo: 1, positionNo: 2 },
    });
    await prisma.filterDefinitionItem.create({
      data: { filterId: "SALES_DETAIL_FILTER", componentCode: "SALES_DETAIL_PRODUCT", rowNo: 2, positionNo: 1 },
    });
    await prisma.filterDefinitionItem.create({
      data: { filterId: "SALES_DETAIL_FILTER", componentCode: "SALES_DETAIL_REGION", rowNo: 2, positionNo: 2 },
    });
  }

  const salesReportData = {
    reportTitle: "Sales Report",
    filterId: "SALES_REPORT_FILTER",
    mode: "REPORT",
    queryText:
      "SELECT company_code, sale_date, product_name, region, quantity, amount FROM sample_sales " +
      "WHERE (:SALES_COMPANY::text IS NULL OR company_code = :SALES_COMPANY) " +
      "AND (:SALES_DATE_RANGE_FROM::date IS NULL OR sale_date >= :SALES_DATE_RANGE_FROM) " +
      "AND (:SALES_DATE_RANGE_TO::date IS NULL OR sale_date <= :SALES_DATE_RANGE_TO) " +
      "ORDER BY sale_date DESC",
    maxRows: 2000,
    freezeColumns: 0,
    displayStyle: "PAGED",
    footerNote: "Figures are for internal review only and exclude GST. Contact the CSO desk for reconciliation queries.",
    allowedFormats: ["CSV"],
    allowedDeliveries: ["DOWNLOAD"],
  };

  await prisma.reportDefinition.upsert({
    where: { reportId: "SALES_REPORT" },
    update: salesReportData,
    create: { reportId: "SALES_REPORT", ...salesReportData },
  });

  // Re-created each seed run (no natural unique key on columnKey to upsert against).
  await prisma.reportColumn.deleteMany({ where: { reportId: "SALES_REPORT" } });
  await prisma.reportColumn.createMany({
    data: [
      { reportId: "SALES_REPORT", columnKey: "company_code", displayLabel: "Company", displayOrder: 1, dataType: "TEXT" },
      { reportId: "SALES_REPORT", columnKey: "sale_date", displayLabel: "Sale Date", displayOrder: 2, dataType: "DATE" },
      { reportId: "SALES_REPORT", columnKey: "product_name", displayLabel: "Product", displayOrder: 3, dataType: "TEXT" },
      { reportId: "SALES_REPORT", columnKey: "region", displayLabel: "Region", displayOrder: 4, dataType: "TEXT" },
      { reportId: "SALES_REPORT", columnKey: "quantity", displayLabel: "Quantity", displayOrder: 5, dataType: "NUMBER" },
      {
        reportId: "SALES_REPORT",
        columnKey: "amount",
        displayLabel: "Amount",
        displayOrder: 6,
        dataType: "NUMBER",
        decimalPlaces: 2,
        isHighlighted: true,
        showTotal: true,
      },
    ],
  });

  // --- Sales Detail (the drill-down target — created first, since Sales Summary's
  // group_value column below references it via a real FK) ---
  const salesDetailData = {
    reportTitle: "Sales Detail",
    filterId: "SALES_DETAIL_FILTER",
    mode: "REPORT",
    queryText:
      "SELECT company_code, sale_date, product_name, region, quantity, amount FROM sample_sales " +
      "WHERE (:SALES_COMPANY::text IS NULL OR company_code = :SALES_COMPANY) " +
      "AND (:SALES_DATE_RANGE_FROM::date IS NULL OR sale_date >= :SALES_DATE_RANGE_FROM) " +
      "AND (:SALES_DATE_RANGE_TO::date IS NULL OR sale_date <= :SALES_DATE_RANGE_TO) " +
      "AND (:SALES_DETAIL_PRODUCT::text IS NULL OR product_name = :SALES_DETAIL_PRODUCT) " +
      "AND (:SALES_DETAIL_REGION::text IS NULL OR region = :SALES_DETAIL_REGION) " +
      "ORDER BY sale_date DESC",
    maxRows: 2000,
    freezeColumns: 0,
    displayStyle: "PAGED",
    footerNote: "Figures are for internal review only and exclude GST.",
    allowedFormats: ["CSV"],
    allowedDeliveries: ["DOWNLOAD"],
  };
  await prisma.reportDefinition.upsert({
    where: { reportId: "SALES_DETAIL" },
    update: salesDetailData,
    create: { reportId: "SALES_DETAIL", ...salesDetailData },
  });
  await prisma.reportColumn.deleteMany({ where: { reportId: "SALES_DETAIL" } });
  await prisma.reportColumn.createMany({
    data: [
      { reportId: "SALES_DETAIL", columnKey: "company_code", displayLabel: "Company", displayOrder: 1, dataType: "TEXT" },
      { reportId: "SALES_DETAIL", columnKey: "sale_date", displayLabel: "Sale Date", displayOrder: 2, dataType: "DATE" },
      { reportId: "SALES_DETAIL", columnKey: "product_name", displayLabel: "Product", displayOrder: 3, dataType: "TEXT" },
      { reportId: "SALES_DETAIL", columnKey: "region", displayLabel: "Region", displayOrder: 4, dataType: "TEXT" },
      { reportId: "SALES_DETAIL", columnKey: "quantity", displayLabel: "Quantity", displayOrder: 5, dataType: "NUMBER" },
      {
        reportId: "SALES_DETAIL",
        columnKey: "amount",
        displayLabel: "Amount",
        displayOrder: 6,
        dataType: "NUMBER",
        decimalPlaces: 2,
        isHighlighted: true,
        showTotal: true,
      },
    ],
  });

  // --- Sales Summary (productwise/regionwise grouping, drills into Sales Detail) ---
  const salesSummaryData = {
    reportTitle: "Sales Summary",
    filterId: "SALES_SUMMARY_FILTER",
    mode: "REPORT",
    queryText:
      "SELECT company_code, " +
      "CASE WHEN :SALES_SUMMARY_TYPE = 'REGION' THEN region ELSE product_name END AS group_value, " +
      "SUM(amount) AS total_amount " +
      "FROM sample_sales " +
      "WHERE (:SALES_COMPANY::text IS NULL OR company_code = :SALES_COMPANY) " +
      "AND (:SALES_DATE_RANGE_FROM::date IS NULL OR sale_date >= :SALES_DATE_RANGE_FROM) " +
      "AND (:SALES_DATE_RANGE_TO::date IS NULL OR sale_date <= :SALES_DATE_RANGE_TO) " +
      "GROUP BY company_code, group_value " +
      "ORDER BY total_amount DESC",
    maxRows: 2000,
    freezeColumns: 0,
    displayStyle: "PAGED",
    footerNote: "Click a product or region to see the underlying transactions.",
    allowedFormats: ["CSV"],
    allowedDeliveries: ["DOWNLOAD"],
  };
  await prisma.reportDefinition.upsert({
    where: { reportId: "SALES_SUMMARY" },
    update: salesSummaryData,
    create: { reportId: "SALES_SUMMARY", ...salesSummaryData },
  });
  await prisma.reportColumn.deleteMany({ where: { reportId: "SALES_SUMMARY" } });
  await prisma.reportColumn.createMany({
    data: [
      { reportId: "SALES_SUMMARY", columnKey: "company_code", displayLabel: "Company", displayOrder: 1, dataType: "TEXT" },
      {
        reportId: "SALES_SUMMARY",
        columnKey: "group_value",
        displayLabel: "Product / Region",
        displayOrder: 2,
        dataType: "TEXT",
        // Discriminator convention: the current SALES_SUMMARY_TYPE value picks which
        // of Sales Detail's own filter params this cell's value actually goes into.
        drillDownReportId: "SALES_DETAIL",
        drillDownTargetParam: JSON.stringify({
          __discriminator: "SALES_SUMMARY_TYPE",
          PRODUCT: "SALES_DETAIL_PRODUCT",
          REGION: "SALES_DETAIL_REGION",
        }),
        drillDownMode: "MODAL",
        drillDownModalSize: "AUTO",
      },
      {
        reportId: "SALES_SUMMARY",
        columnKey: "total_amount",
        displayLabel: "Amount",
        displayOrder: 3,
        dataType: "NUMBER",
        decimalPlaces: 2,
        isHighlighted: true,
        showTotal: true,
      },
    ],
  });

  // --- Sales Entry: the same filter engine used as an add/edit/delete FORM.
  // Every item carries a mappedColumn — that mapping is what turns a filter field
  // into a column write. Show/Save and Reset are rendered by the engine itself.
  await prisma.filterDefinition.upsert({
    where: { filterId: "SALES_ENTRY_FILTER" },
    update: {},
    create: { filterId: "SALES_ENTRY_FILTER", filterName: "Sales Entry Form", isCollapsible: true, defaultCollapsed: false },
  });
  const existingEntryFilterItems = await prisma.filterDefinitionItem.findMany({ where: { filterId: "SALES_ENTRY_FILTER" } });
  if (existingEntryFilterItems.length === 0) {
    const ENTRY_ITEMS = [
      { componentCode: "SALES_COMPANY", rowNo: 1, positionNo: 1, mappedColumn: "company_code" },
      { componentCode: "SALES_ENTRY_DATE", rowNo: 1, positionNo: 2, mappedColumn: "sale_date" },
      { componentCode: "SALES_ENTRY_PRODUCT", rowNo: 1, positionNo: 3, mappedColumn: "product_name" },
      { componentCode: "SALES_ENTRY_REGION", rowNo: 2, positionNo: 1, mappedColumn: "region" },
      { componentCode: "SALES_ENTRY_QUANTITY", rowNo: 2, positionNo: 2, mappedColumn: "quantity" },
      { componentCode: "SALES_ENTRY_AMOUNT", rowNo: 2, positionNo: 3, mappedColumn: "amount" },
    ];
    for (const item of ENTRY_ITEMS) {
      await prisma.filterDefinitionItem.create({
        data: { filterId: "SALES_ENTRY_FILTER", isMandatory: true, ...item },
      });
    }
  }

  const salesEntryData = {
    reportTitle: "Sales Entry",
    filterId: "SALES_ENTRY_FILTER",
    mode: "FORM",
    targetTable: "sample_sales",
    // The engine wraps this as SELECT * FROM (<queryText>) WHERE created_by = <user>,
    // so created_by has to be in the projection even though no column displays it.
    queryText:
      "SELECT id, company_code, sale_date, product_name, region, quantity, amount, created_by " +
      "FROM sample_sales ORDER BY id DESC",
    maxRows: 2000,
    freezeColumns: 0,
    displayStyle: "PAGED",
    footerNote: "You only see and edit the rows you created.",
    allowedFormats: ["CSV"],
    allowedDeliveries: ["DOWNLOAD"],
  };
  await prisma.reportDefinition.upsert({
    where: { reportId: "SALES_ENTRY" },
    update: salesEntryData,
    create: { reportId: "SALES_ENTRY", ...salesEntryData },
  });

  await prisma.reportColumn.deleteMany({ where: { reportId: "SALES_ENTRY" } });
  await prisma.reportColumn.createMany({
    data: [
      // isIdentifier marks the primary key the engine edits/deletes by.
      { reportId: "SALES_ENTRY", columnKey: "id", displayLabel: "ID", displayOrder: 1, dataType: "NUMBER", isIdentifier: true },
      { reportId: "SALES_ENTRY", columnKey: "company_code", displayLabel: "Company", displayOrder: 2, dataType: "TEXT" },
      { reportId: "SALES_ENTRY", columnKey: "sale_date", displayLabel: "Sale Date", displayOrder: 3, dataType: "DATE" },
      { reportId: "SALES_ENTRY", columnKey: "product_name", displayLabel: "Product", displayOrder: 4, dataType: "TEXT" },
      { reportId: "SALES_ENTRY", columnKey: "region", displayLabel: "Region", displayOrder: 5, dataType: "TEXT" },
      { reportId: "SALES_ENTRY", columnKey: "quantity", displayLabel: "Quantity", displayOrder: 6, dataType: "NUMBER" },
      {
        reportId: "SALES_ENTRY",
        columnKey: "amount",
        displayLabel: "Amount",
        displayOrder: 7,
        dataType: "NUMBER",
        decimalPlaces: 2,
        showTotal: true,
      },
    ],
  });

  await prisma.menuMaster.upsert({
    where: { menuCode: "UTILITIES" },
    update: { appCode: "BROKING", menuName: "Utilities", icon: "🧰", level: 1, parentMenuCode: null, displayOrder: 50, isActive: true },
    create: {
      appCode: "BROKING",
      menuCode: "UTILITIES",
      menuName: "Utilities",
      icon: "🧰",
      menuType: "ROUTE",
      level: 1,
      displayOrder: 50,
      companyCode: "SIHL",
      hierarchyCode: "9999",
      isActive: true,
    },
  });
  await prisma.menuMaster.upsert({
    where: { menuCode: "UTILITIES_SAMPLE" },
    update: { appCode: "BROKING", menuName: "Sample", level: 2, parentMenuCode: "UTILITIES", displayOrder: 10, isActive: true },
    create: {
      appCode: "BROKING",
      menuCode: "UTILITIES_SAMPLE",
      parentMenuCode: "UTILITIES",
      menuName: "Sample",
      menuType: "ROUTE",
      level: 2,
      displayOrder: 10,
      companyCode: "SIHL",
      hierarchyCode: "9999",
      isActive: true,
    },
  });
  await prisma.menuMaster.upsert({
    where: { menuCode: "SALES_REPORT_MENU" },
    update: { appCode: "BROKING", menuName: "Sales Report", level: 3, parentMenuCode: "UTILITIES_SAMPLE", displayOrder: 100, isActive: true },
    create: {
      appCode: "BROKING",
      menuCode: "SALES_REPORT_MENU",
      parentMenuCode: "UTILITIES_SAMPLE",
      menuName: "Sales Report",
      icon: "📈",
      menuType: "REPORT",
      reportId: "SALES_REPORT",
      level: 3,
      displayOrder: 100,
      companyCode: "SIHL",
      hierarchyCode: "9999",
      isActive: true,
    },
  });
  // Sales Detail deliberately has no menu entry — it's reachable only via drill-down
  // from Sales Summary (or by report ID directly), not a standalone nav item.
  await prisma.menuMaster.upsert({
    where: { menuCode: "SALES_SUMMARY_MENU" },
    update: { appCode: "BROKING", menuName: "Sales Summary", level: 3, parentMenuCode: "UTILITIES_SAMPLE", displayOrder: 90, isActive: true },
    create: {
      appCode: "BROKING",
      menuCode: "SALES_SUMMARY_MENU",
      parentMenuCode: "UTILITIES_SAMPLE",
      menuName: "Sales Summary",
      icon: "📊",
      menuType: "REPORT",
      reportId: "SALES_SUMMARY",
      level: 3,
      displayOrder: 90,
      companyCode: "SIHL",
      hierarchyCode: "9999",
      isActive: true,
    },
  });
  // A second app with its own menu tree, so switching apps visibly swaps the sidebar.
  await prisma.menuMaster.upsert({
    where: { menuCode: "BO_ROOT" },
    update: { appCode: "BACKOFFICE", menuName: "Operations", icon: "🧾", level: 1, parentMenuCode: null, displayOrder: 10, isActive: true },
    create: {
      appCode: "BACKOFFICE",
      menuCode: "BO_ROOT",
      menuName: "Operations",
      icon: "🧾",
      menuType: "ROUTE",
      level: 1,
      displayOrder: 10,
      companyCode: "SIHL",
      hierarchyCode: "9999",
      isActive: true,
    },
  });
  await prisma.menuMaster.upsert({
    where: { menuCode: "BO_SETTLEMENT" },
    update: { appCode: "BACKOFFICE", menuName: "Settlement Summary", level: 2, parentMenuCode: "BO_ROOT", displayOrder: 10, isActive: true },
    create: {
      appCode: "BACKOFFICE",
      menuCode: "BO_SETTLEMENT",
      parentMenuCode: "BO_ROOT",
      menuName: "Settlement Summary",
      icon: "📊",
      menuType: "REPORT",
      reportId: "SALES_SUMMARY",
      level: 2,
      displayOrder: 10,
      companyCode: "SIHL",
      hierarchyCode: "9999",
      isActive: true,
    },
  });

  await prisma.menuMaster.upsert({
    where: { menuCode: "SALES_ENTRY_MENU" },
    update: { appCode: "BROKING", menuName: "Sales Entry", level: 3, parentMenuCode: "UTILITIES_SAMPLE", displayOrder: 110, isActive: true },
    create: {
      appCode: "BROKING",
      menuCode: "SALES_ENTRY_MENU",
      parentMenuCode: "UTILITIES_SAMPLE",
      menuName: "Sales Entry",
      icon: "📝",
      menuType: "REPORT",
      reportId: "SALES_ENTRY",
      level: 3,
      displayOrder: 110,
      companyCode: "SIHL",
      hierarchyCode: "9999",
      isActive: true,
    },
  });
  for (const menuCode of ["UTILITIES", "UTILITIES_SAMPLE", "SALES_REPORT_MENU", "SALES_SUMMARY_MENU", "SALES_ENTRY_MENU", "BO_ROOT", "BO_SETTLEMENT"]) {
    await prisma.roleMenuMap.upsert({
      where: {
        roleCode_menuCode_companyCode_hierarchyCode: {
          roleCode: "ADMIN",
          menuCode,
          companyCode: "SIHL",
          hierarchyCode: "9999",
        },
      },
      update: { isActive: true },
      create: { roleCode: "ADMIN", menuCode, companyCode: "SIHL", hierarchyCode: "9999", isActive: true },
    });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
