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
    update: { companyLogoFileLocation: "/logos/sihllogo.jpg" },
    create: {
      companyCode: "SIHL",
      companyName: "Shah Investor's Home Limited",
      companyLogoFileLocation: "/logos/sihllogo.jpg",
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

  // Distinct contact details from Manesh001 on purpose. When both accounts shared an email
  // and mobile, identity resolution (§4.2) could never match either of them — the ambiguity
  // guard correctly refused to guess between two records, so every ticket raised with that
  // address became a guest ticket. A system account should carry its own contact anyway.
  // These are in `update` as well as `create` so existing databases converge on re-seed.
  const adminUser = await prisma.userDetails.upsert({
    where: { username: "Admin001" },
    update: { email: "admin@sihl.local", mobile: "9800000001" },
    create: {
      companyCode: "SIHL",
      username: "Admin001",
      passwordHash: adminPasswordHash,
      customerId: "Admin001",
      fullName: "Manesh Anand Mukherjee",
      mobile: "9800000001",
      email: "admin@sihl.local",
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

  // Upserted rather than left to the createMany below: that call uses
  // skipDuplicates, so an existing row would keep its old — unscoped — query
  // forever. This one is security-relevant, so re-seeding must be able to fix it.
  const salesCompanyComponent = {
    componentName: "Company",
    componentType: "DROPDOWN",
    dataSourceType: "SQL",
    // Scoped to the caller: without this a user could pick any company and, if the
    // report had no companyScopeColumn, read another company's book.
    dataSourceQuery:
      "SELECT company_code as value, company_name as label FROM company_master " +
      "WHERE is_active = true AND company_code = :SESSION_COMPANY ORDER BY company_name",
  };
  await prisma.filterComponentMaster.upsert({
    where: { componentCode: "SALES_COMPANY" },
    update: salesCompanyComponent,
    create: { componentCode: "SALES_COMPANY", ...salesCompanyComponent },
  });

  await prisma.filterComponentMaster.createMany({
    data: [
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
    // Enforced by the engine, so the report cannot return another company's rows
    // even if the query author omits a predicate.
    companyScopeColumn: "company_code",
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
    // Enforced by the engine, so the report cannot return another company's rows
    // even if the query author omits a predicate.
    companyScopeColumn: "company_code",
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
    // Enforced by the engine, so the report cannot return another company's rows
    // even if the query author omits a predicate.
    companyScopeColumn: "company_code",
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

  // --- Issue Tracker & Service Request System, Phase 1 (docs/04-issue-tracker-brs.md) ---
  //
  // A dedicated "Support" app rather than menus inside Broking: BRS §4.1 treats Synapse
  // itself as an intake channel, and since app access is derived from menu grants, giving
  // the support roles their menus grants them the app automatically.

  await prisma.appMaster.upsert({
    where: { appCode: "SUPPORT" },
    update: {
      appName: "Support",
      icon: "🎧",
      displayOrder: 3,
      description: "Issue tracking, service requests and change requests.",
      isActive: true,
    },
    create: {
      appCode: "SUPPORT",
      appName: "Support",
      companyCode: "SIHL",
      icon: "🎧",
      displayOrder: 3,
      description: "Issue tracking, service requests and change requests.",
      isActive: true,
    },
  });

  // Three roles, because the BRS names three distinct authorities: the desk triages and
  // resolves (§4.5), the lead additionally owns the taxonomy (§4.3), and Product/Ops alone
  // approves change-request conversion (§4.6).
  //
  // NOTE: a menu grant only controls *visibility*. §4.6's approval authority must also be
  // enforced server-side in the route handler — hiding a menu is not an access control.
  const SUPPORT_ROLES = [
    { roleCode: "SUPPORT_DESK", roleName: "Support Desk" },
    { roleCode: "SUPPORT_LEAD", roleName: "Support Lead" },
    { roleCode: "PRODUCT_OPS", roleName: "Product / Ops" },
  ];
  for (const r of SUPPORT_ROLES) {
    await prisma.roleMaster.upsert({
      where: { roleCode: r.roleCode },
      update: {},
      create: { ...r, companyCode: "SIHL", hierarchyCode: "0200", isActive: true },
    });
  }

  // NOTE: four of these pages are not built yet (Triage Queue is step 5, Change Requests
  // step 6, Document Requests step 7, Issue Categories step 3), so their menu items are
  // live but 404. Gating them on an "is it built" flag is parked, because deactivating a
  // menu also removes it from getAccessibleMenuCodes — and canLogForOthers() in
  // src/lib/tickets.ts derives support-staff status from the SUP_QUEUE grant, so hiding
  // that one menu would silently revoke the ability to log a ticket for someone else.
  const SUPPORT_MENUS: {
    code: string;
    parent: string | null;
    name: string;
    icon: string;
    route: string | null;
    level: number;
    order: number;
  }[] = [
    { code: "SUPPORT_ROOT", parent: null, name: "Support", icon: "🎧", route: null, level: 1, order: 10 },
    { code: "SUP_RAISE", parent: "SUPPORT_ROOT", name: "Raise a Ticket", icon: "✏️", route: "/support/tickets/new", level: 2, order: 10 },
    { code: "SUP_MY", parent: "SUPPORT_ROOT", name: "My Tickets", icon: "🎫", route: "/support/tickets", level: 2, order: 20 },
    { code: "SUP_QUEUE", parent: "SUPPORT_ROOT", name: "Triage Queue", icon: "📥", route: "/support/queue", level: 2, order: 30 },
    { code: "SUP_CR", parent: "SUPPORT_ROOT", name: "Change Requests", icon: "🚧", route: "/support/change-requests", level: 2, order: 40 },
    { code: "SUP_DOCS", parent: "SUPPORT_ROOT", name: "Document Requests", icon: "📄", route: "/support/documents", level: 2, order: 50 },
    // Lives in the Support app, not /admin: §4.3 makes the support lead the owner, and an
    // /admin route would put it behind requireAdmin() and out of their reach.
    { code: "SUP_CATEGORIES", parent: "SUPPORT_ROOT", name: "Issue Categories", icon: "🏷️", route: "/support/categories", level: 2, order: 60 },
  ];

  for (const m of SUPPORT_MENUS) {
    await prisma.menuMaster.upsert({
      where: { menuCode: m.code },
      update: {
        appCode: "SUPPORT",
        menuName: m.name,
        icon: m.icon,
        routePath: m.route,
        level: m.level,
        parentMenuCode: m.parent,
        displayOrder: m.order,
        isActive: true,
      },
      create: {
        appCode: "SUPPORT",
        menuCode: m.code,
        parentMenuCode: m.parent,
        menuName: m.name,
        icon: m.icon,
        menuType: "ROUTE",
        routePath: m.route,
        level: m.level,
        displayOrder: m.order,
        companyCode: "SIHL",
        hierarchyCode: "9999",
        isActive: true,
      },
    });
  }

  const SUPPORT_MENU_GRANTS: Record<string, string[]> = {
    SUPPORT_DESK: ["SUPPORT_ROOT", "SUP_RAISE", "SUP_MY", "SUP_QUEUE", "SUP_CR", "SUP_DOCS"],
    SUPPORT_LEAD: SUPPORT_MENUS.map((m) => m.code),
    PRODUCT_OPS: ["SUPPORT_ROOT", "SUP_MY", "SUP_CR"],
  };

  // getAccessibleMenuCodes filters role_menu_map by the *user's* hierarchy, so a grant only
  // takes effect for users in a hierarchy it was created for. Seeding across the staff
  // hierarchies means assigning a support role to any staff user just works, rather than
  // silently showing them an empty app.
  const STAFF_HIERARCHIES = ["0000", "0100", "0200", "0300"];
  for (const [roleCode, menuCodes] of Object.entries(SUPPORT_MENU_GRANTS)) {
    for (const hierarchyCode of STAFF_HIERARCHIES) {
      for (const menuCode of menuCodes) {
        await prisma.roleMenuMap.upsert({
          where: {
            roleCode_menuCode_companyCode_hierarchyCode: {
              roleCode,
              menuCode,
              companyCode: "SIHL",
              hierarchyCode,
            },
          },
          update: { isActive: true },
          create: { roleCode, menuCode, companyCode: "SIHL", hierarchyCode, isActive: true },
        });
      }
    }
  }

  // ADMIN too, at 9999, so the seeded admin account can exercise the whole module without
  // first being given a support role.
  for (const m of SUPPORT_MENUS) {
    await prisma.roleMenuMap.upsert({
      where: {
        roleCode_menuCode_companyCode_hierarchyCode: {
          roleCode: "ADMIN",
          menuCode: m.code,
          companyCode: "SIHL",
          hierarchyCode: "9999",
        },
      },
      update: { isActive: true },
      create: { roleCode: "ADMIN", menuCode: m.code, companyCode: "SIHL", hierarchyCode: "9999", isActive: true },
    });
  }

  // A demo client. BRS §3 lists the client as an actor who raises issues and service
  // requests, and §4.7's delivery rules cannot resolve a target at all without one — a staff
  // member requesting a ledger needs a real client record with a registered email to send to
  // and copy. CLIENT_SELF is the client-facing role: raise a ticket, see your own, request a
  // document. Deliberately no triage queue, so canLogForOthers() stays false for them.
  const demoClient = await prisma.userDetails.upsert({
    where: { username: "Client001" },
    update: { email: "client.demo@example.com", customerId: "C1001" },
    create: {
      companyCode: "SIHL",
      username: "Client001",
      passwordHash: await bcrypt.hash(SEED_PASSWORD, 10),
      customerId: "C1001",
      fullName: "Demo Client One",
      mobile: "9700000001",
      email: "client.demo@example.com",
      lastPasswordChangedDate: new Date("1900-01-01"),
      hierarchyCode: "0800",
      clientCategoryCode: "C00",
      isActive: true,
    },
  });

  await prisma.roleMaster.upsert({
    where: { roleCode: "CLIENT_SELF" },
    update: {},
    create: {
      roleCode: "CLIENT_SELF",
      roleName: "Client Self-Service",
      companyCode: "SIHL",
      hierarchyCode: "0800",
      isActive: true,
    },
  });
  for (const menuCode of ["SUPPORT_ROOT", "SUP_RAISE", "SUP_MY", "SUP_DOCS"]) {
    await prisma.roleMenuMap.upsert({
      where: {
        roleCode_menuCode_companyCode_hierarchyCode: {
          roleCode: "CLIENT_SELF",
          menuCode,
          companyCode: "SIHL",
          hierarchyCode: "0800",
        },
      },
      update: { isActive: true },
      create: { roleCode: "CLIENT_SELF", menuCode, companyCode: "SIHL", hierarchyCode: "0800", isActive: true },
    });
  }
  await prisma.userRoleMap.upsert({
    where: { userUid_roleCode: { userUid: demoClient.uid, roleCode: "CLIENT_SELF" } },
    update: { isActive: true },
    create: { userUid: demoClient.uid, roleCode: "CLIENT_SELF", isActive: true },
  });

  // Give Manesh001 the desk role. Without this the three support roles exist but belong to
  // nobody, so there is no way to exercise the module as anyone other than an administrator
  // — and in particular no way to check that §4.6's approval gate actually holds, since ADMIN
  // can approve. This account can propose a change request but must not be able to decide it.
  await prisma.userRoleMap.upsert({
    where: { userUid_roleCode: { userUid: user.uid, roleCode: "SUPPORT_DESK" } },
    update: { isActive: true },
    create: { userUid: user.uid, roleCode: "SUPPORT_DESK", isActive: true },
  });

  // Provisional taxonomy (§4.3). BRS §11 item 2 leaves the final list to the support lead,
  // who revises it in-app — these are a workable starting set, not a fixed catalogue.
  const ISSUE_CATEGORIES: { code: string; name: string; module: string; type: string; order: number }[] = [
    { code: "EQ-QUERY", name: "Equities — Query", module: "Equities", type: "QUERY", order: 10 },
    { code: "EQ-BUG", name: "Equities — Bug", module: "Equities", type: "BUG", order: 20 },
    { code: "EQ-COMPLAINT", name: "Equities — Complaint", module: "Equities", type: "COMPLAINT", order: 30 },
    { code: "FO-QUERY", name: "Derivatives — Query", module: "Derivatives", type: "QUERY", order: 40 },
    { code: "FO-BUG", name: "Derivatives — Bug", module: "Derivatives", type: "BUG", order: 50 },
    { code: "BO-QUERY", name: "Back Office — Query", module: "Back Office", type: "QUERY", order: 60 },
    { code: "BO-COMPLAINT", name: "Back Office — Complaint", module: "Back Office", type: "COMPLAINT", order: 70 },
    { code: "BO-SERVICE_REQUEST", name: "Back Office — Document Request", module: "Back Office", type: "SERVICE_REQUEST", order: 80 },
    { code: "RMS-QUERY", name: "RMS — Query", module: "RMS", type: "QUERY", order: 90 },
    { code: "RMS-COMPLAINT", name: "RMS — Complaint", module: "RMS", type: "COMPLAINT", order: 100 },
    { code: "RMS-BUG", name: "RMS — Bug", module: "RMS", type: "BUG", order: 110 },
    { code: "PAY-QUERY", name: "Payments & Funds — Query", module: "Payments & Funds", type: "QUERY", order: 120 },
    { code: "PAY-COMPLAINT", name: "Payments & Funds — Complaint", module: "Payments & Funds", type: "COMPLAINT", order: 130 },
    { code: "KYC-QUERY", name: "KYC & Onboarding — Query", module: "KYC & Onboarding", type: "QUERY", order: 140 },
    { code: "KYC-SERVICE_REQUEST", name: "KYC & Onboarding — Service Request", module: "KYC & Onboarding", type: "SERVICE_REQUEST", order: 150 },
  ];

  for (const c of ISSUE_CATEGORIES) {
    await prisma.issueCategory.upsert({
      where: { categoryCode: c.code },
      update: { categoryName: c.name, productModule: c.module, issueType: c.type, displayOrder: c.order },
      create: {
        categoryCode: c.code,
        categoryName: c.name,
        productModule: c.module,
        issueType: c.type,
        displayOrder: c.order,
        isActive: true,
      },
    });
  }

  // --- §4.8 Basic reporting -------------------------------------------------
  //
  // Built as ReportDefinition rows rather than a bespoke page. That is the whole point of
  // the engine: filters, typed formatting, sorting, totals, CSV export and drill-down come
  // for free, the SQL runs on the read-only connection behind assertSelectOnly, and Phase 2's
  // CEO dashboard can read the same definitions. §4.8 explicitly asks for a report, not a
  // dashboard, so nothing here is bespoke UI.
  //
  // Every query filters `merged_into_ticket_id IS NULL`. That is the §4.4 rule made real:
  // an absorbed ticket's history lives on the surviving thread, so counting both would
  // double-count one issue and drag the average turnaround down.
  //
  // Scoping uses `:SESSION_COMPANY` inside each query rather than companyScopeColumn,
  // because these are aggregates — there is no per-row company column to wrap once a result
  // has been grouped by day.

  await prisma.filterComponentMaster.createMany({
    data: [
      {
        componentCode: "SUPPORT_DATE_RANGE",
        componentName: "Date Range",
        componentType: "DATE_RANGE",
        dataSourceType: "NONE",
      },
      {
        componentCode: "SUPPORT_PRODUCT_MODULE",
        componentName: "Product / Module",
        componentType: "DROPDOWN",
        dataSourceType: "SQL",
        dataSourceQuery:
          "SELECT DISTINCT product_module AS value, product_module AS label FROM issue_category " +
          "WHERE is_active = true ORDER BY product_module",
      },
    ],
    skipDuplicates: true,
  });

  for (const [filterId, filterName] of [
    ["SUPPORT_STATS_FILTER", "Ticket Stats Filter"],
    ["SUPPORT_CATEGORY_FILTER", "Ticket Category Filter"],
    ["SUPPORT_TICKETS_FILTER", "Ticket List Filter"],
  ]) {
    await prisma.filterDefinition.upsert({
      where: { filterId },
      update: {},
      create: { filterId, filterName, isCollapsible: true, defaultCollapsed: false },
    });
    const existing = await prisma.filterDefinitionItem.findMany({ where: { filterId } });
    if (existing.length === 0) {
      // Same componentCode across all three filters on purpose — that is what makes the
      // drill-down's automatic carry-over work, with no source->target mapping to configure.
      await prisma.filterDefinitionItem.create({
        data: {
          filterId,
          componentCode: "SUPPORT_DATE_RANGE",
          rowNo: 1,
          positionNo: 1,
          // Mandatory only for the daily report, whose day series needs real bounds.
          isMandatory: filterId === "SUPPORT_STATS_FILTER",
        },
      });
      if (filterId === "SUPPORT_TICKETS_FILTER") {
        await prisma.filterDefinitionItem.create({
          data: { filterId, componentCode: "SUPPORT_PRODUCT_MODULE", rowNo: 1, positionNo: 2 },
        });
      }
    }
  }

  const dailyStatsData = {
    reportTitle: "Daily Ticket Stats",
    filterId: "SUPPORT_STATS_FILTER",
    mode: "REPORT",
    queryText:
      "WITH bounds AS (SELECT " +
      "COALESCE(:SUPPORT_DATE_RANGE_FROM::date, (CURRENT_DATE - INTERVAL '30 days')::date) AS d_from, " +
      "COALESCE(:SUPPORT_DATE_RANGE_TO::date, CURRENT_DATE) AS d_to), " +
      "days AS (SELECT generate_series((SELECT d_from FROM bounds), (SELECT d_to FROM bounds), INTERVAL '1 day')::date AS day), " +
      "scoped AS (SELECT * FROM ticket WHERE merged_into_ticket_id IS NULL AND company_code = :SESSION_COMPANY), " +
      "raised AS (SELECT raised_at::date AS d, COUNT(*)::int AS n FROM scoped GROUP BY 1), " +
      "closed AS (SELECT closed_at::date AS d, COUNT(*)::int AS n FROM scoped WHERE closed_at IS NOT NULL GROUP BY 1), " +
      "fwd AS (SELECT e.created_at::date AS d, COUNT(DISTINCT e.ticket_id)::int AS n FROM ticket_event e " +
      "JOIN scoped t ON t.id = e.ticket_id WHERE e.event_type = 'FORWARD' GROUP BY 1), " +
      "res AS (SELECT resolved_at::date AS d, " +
      "ROUND((AVG(EXTRACT(EPOCH FROM (resolved_at - sla_clock_start_at))) / 3600.0)::numeric, 2) AS hrs " +
      "FROM scoped WHERE resolved_at IS NOT NULL GROUP BY 1) " +
      "SELECT days.day AS stat_date, COALESCE(raised.n, 0) AS tickets_raised, " +
      "COALESCE(closed.n, 0) AS tickets_closed, COALESCE(fwd.n, 0) AS tickets_forwarded, " +
      "res.hrs AS avg_turnaround_hours FROM days " +
      "LEFT JOIN raised ON raised.d = days.day LEFT JOIN closed ON closed.d = days.day " +
      "LEFT JOIN fwd ON fwd.d = days.day LEFT JOIN res ON res.d = days.day " +
      "ORDER BY days.day DESC",
    maxRows: 2000,
    freezeColumns: 0,
    displayStyle: "PAGED",
    footerNote:
      "Merged tickets are counted once, on the surviving thread. Turnaround runs from the ticket's clock start, which a merge moves back to the earlier of the two reports.",
    allowedFormats: ["CSV"],
    allowedDeliveries: ["DOWNLOAD"],
    isActive: true,
  };
  await prisma.reportDefinition.upsert({
    where: { reportId: "SUPPORT_DAILY_STATS" },
    update: dailyStatsData,
    create: { reportId: "SUPPORT_DAILY_STATS", ...dailyStatsData },
  });
  await prisma.reportColumn.deleteMany({ where: { reportId: "SUPPORT_DAILY_STATS" } });
  await prisma.reportColumn.createMany({
    data: [
      { reportId: "SUPPORT_DAILY_STATS", columnKey: "stat_date", displayLabel: "Date", displayOrder: 1, dataType: "DATE" },
      { reportId: "SUPPORT_DAILY_STATS", columnKey: "tickets_raised", displayLabel: "Raised", displayOrder: 2, dataType: "NUMBER", showTotal: true },
      { reportId: "SUPPORT_DAILY_STATS", columnKey: "tickets_closed", displayLabel: "Closed", displayOrder: 3, dataType: "NUMBER", showTotal: true },
      { reportId: "SUPPORT_DAILY_STATS", columnKey: "tickets_forwarded", displayLabel: "Forwarded", displayOrder: 4, dataType: "NUMBER", showTotal: true },
      {
        reportId: "SUPPORT_DAILY_STATS",
        columnKey: "avg_turnaround_hours",
        displayLabel: "Avg Turnaround (hrs)",
        displayOrder: 5,
        dataType: "NUMBER",
        decimalPlaces: 2,
        isHighlighted: true,
        // Deliberately no total: summing daily averages would be arithmetically meaningless.
        showTotal: false,
      },
    ],
  });

  // Drill target — reachable only from Ticket Categories, so it gets no menu entry, the
  // same arrangement as SALES_DETAIL.
  const ticketListData = {
    reportTitle: "Ticket List",
    filterId: "SUPPORT_TICKETS_FILTER",
    mode: "REPORT",
    queryText:
      "SELECT t.ticket_no, t.subject, c.product_module, c.category_name, t.status, t.channel, " +
      "t.raised_at, t.resolved_at, " +
      "ROUND((EXTRACT(EPOCH FROM (COALESCE(t.resolved_at, NOW()) - t.sla_clock_start_at)) / 3600.0)::numeric, 2) AS turnaround_hours, " +
      "COALESCE(u.full_name, t.guest_name, 'Guest') AS raised_by " +
      "FROM ticket t JOIN issue_category c ON c.category_code = t.category_code " +
      "LEFT JOIN user_details u ON u.uid = t.raiser_uid " +
      "WHERE t.merged_into_ticket_id IS NULL AND t.company_code = :SESSION_COMPANY " +
      "AND (:SUPPORT_DATE_RANGE_FROM::date IS NULL OR t.raised_at::date >= :SUPPORT_DATE_RANGE_FROM) " +
      "AND (:SUPPORT_DATE_RANGE_TO::date IS NULL OR t.raised_at::date <= :SUPPORT_DATE_RANGE_TO) " +
      "AND (:SUPPORT_PRODUCT_MODULE::text IS NULL OR c.product_module = :SUPPORT_PRODUCT_MODULE) " +
      "ORDER BY t.raised_at DESC",
    maxRows: 2000,
    freezeColumns: 0,
    displayStyle: "PAGED",
    footerNote: "Excludes tickets merged into another thread.",
    allowedFormats: ["CSV"],
    allowedDeliveries: ["DOWNLOAD"],
    isActive: true,
  };
  await prisma.reportDefinition.upsert({
    where: { reportId: "SUPPORT_TICKET_LIST" },
    update: ticketListData,
    create: { reportId: "SUPPORT_TICKET_LIST", ...ticketListData },
  });
  await prisma.reportColumn.deleteMany({ where: { reportId: "SUPPORT_TICKET_LIST" } });
  await prisma.reportColumn.createMany({
    data: [
      { reportId: "SUPPORT_TICKET_LIST", columnKey: "ticket_no", displayLabel: "Ticket", displayOrder: 1, dataType: "TEXT" },
      { reportId: "SUPPORT_TICKET_LIST", columnKey: "subject", displayLabel: "Subject", displayOrder: 2, dataType: "TEXT" },
      { reportId: "SUPPORT_TICKET_LIST", columnKey: "product_module", displayLabel: "Module", displayOrder: 3, dataType: "TEXT" },
      { reportId: "SUPPORT_TICKET_LIST", columnKey: "category_name", displayLabel: "Category", displayOrder: 4, dataType: "TEXT" },
      { reportId: "SUPPORT_TICKET_LIST", columnKey: "raised_by", displayLabel: "Raised By", displayOrder: 5, dataType: "TEXT" },
      { reportId: "SUPPORT_TICKET_LIST", columnKey: "status", displayLabel: "Status", displayOrder: 6, dataType: "TEXT" },
      { reportId: "SUPPORT_TICKET_LIST", columnKey: "channel", displayLabel: "Channel", displayOrder: 7, dataType: "TEXT" },
      { reportId: "SUPPORT_TICKET_LIST", columnKey: "raised_at", displayLabel: "Raised", displayOrder: 8, dataType: "DATETIME" },
      { reportId: "SUPPORT_TICKET_LIST", columnKey: "resolved_at", displayLabel: "Resolved", displayOrder: 9, dataType: "DATETIME" },
      {
        reportId: "SUPPORT_TICKET_LIST",
        columnKey: "turnaround_hours",
        displayLabel: "Turnaround (hrs)",
        displayOrder: 10,
        dataType: "NUMBER",
        decimalPlaces: 2,
      },
    ],
  });

  const categoryStatsData = {
    reportTitle: "Tickets by Category",
    filterId: "SUPPORT_CATEGORY_FILTER",
    mode: "REPORT",
    queryText:
      "SELECT c.product_module, c.issue_type, c.category_name, COUNT(*)::int AS tickets_raised, " +
      "COUNT(*) FILTER (WHERE t.status IN ('OPEN','IN_PROGRESS','FORWARDED','AWAITING_CR_APPROVAL'))::int AS still_open, " +
      "COUNT(*) FILTER (WHERE t.resolved_at IS NOT NULL)::int AS resolved, " +
      "ROUND((AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.sla_clock_start_at))) FILTER (WHERE t.resolved_at IS NOT NULL) / 3600.0)::numeric, 2) AS avg_turnaround_hours " +
      "FROM ticket t JOIN issue_category c ON c.category_code = t.category_code " +
      "WHERE t.merged_into_ticket_id IS NULL AND t.company_code = :SESSION_COMPANY " +
      "AND (:SUPPORT_DATE_RANGE_FROM::date IS NULL OR t.raised_at::date >= :SUPPORT_DATE_RANGE_FROM) " +
      "AND (:SUPPORT_DATE_RANGE_TO::date IS NULL OR t.raised_at::date <= :SUPPORT_DATE_RANGE_TO) " +
      "GROUP BY 1, 2, 3 ORDER BY 4 DESC",
    maxRows: 2000,
    freezeColumns: 0,
    displayStyle: "PAGED",
    footerNote: "Click a module to see the tickets behind the number.",
    allowedFormats: ["CSV"],
    allowedDeliveries: ["DOWNLOAD"],
    isActive: true,
  };
  await prisma.reportDefinition.upsert({
    where: { reportId: "SUPPORT_CATEGORY_STATS" },
    update: categoryStatsData,
    create: { reportId: "SUPPORT_CATEGORY_STATS", ...categoryStatsData },
  });
  await prisma.reportColumn.deleteMany({ where: { reportId: "SUPPORT_CATEGORY_STATS" } });
  await prisma.reportColumn.createMany({
    data: [
      {
        reportId: "SUPPORT_CATEGORY_STATS",
        columnKey: "product_module",
        displayLabel: "Product / Module",
        displayOrder: 1,
        dataType: "TEXT",
        // Phase 2's dashboard wants "which topics drive the volume"; this is that, one
        // click deep, without any new UI.
        drillDownReportId: "SUPPORT_TICKET_LIST",
        drillDownTargetParam: "SUPPORT_PRODUCT_MODULE",
        drillDownMode: "PAGE",
      },
      { reportId: "SUPPORT_CATEGORY_STATS", columnKey: "issue_type", displayLabel: "Issue Type", displayOrder: 2, dataType: "TEXT" },
      { reportId: "SUPPORT_CATEGORY_STATS", columnKey: "category_name", displayLabel: "Category", displayOrder: 3, dataType: "TEXT" },
      { reportId: "SUPPORT_CATEGORY_STATS", columnKey: "tickets_raised", displayLabel: "Raised", displayOrder: 4, dataType: "NUMBER", showTotal: true },
      { reportId: "SUPPORT_CATEGORY_STATS", columnKey: "still_open", displayLabel: "Still Open", displayOrder: 5, dataType: "NUMBER", showTotal: true, isHighlighted: true },
      { reportId: "SUPPORT_CATEGORY_STATS", columnKey: "resolved", displayLabel: "Resolved", displayOrder: 6, dataType: "NUMBER", showTotal: true },
      {
        reportId: "SUPPORT_CATEGORY_STATS",
        columnKey: "avg_turnaround_hours",
        displayLabel: "Avg Turnaround (hrs)",
        displayOrder: 7,
        dataType: "NUMBER",
        decimalPlaces: 2,
      },
    ],
  });

  const REPORT_MENUS = [
    { code: "SUP_RPT_DAILY", name: "Daily Ticket Stats", reportId: "SUPPORT_DAILY_STATS", order: 70 },
    { code: "SUP_RPT_CATEGORY", name: "Tickets by Category", reportId: "SUPPORT_CATEGORY_STATS", order: 80 },
  ];
  for (const m of REPORT_MENUS) {
    await prisma.menuMaster.upsert({
      where: { menuCode: m.code },
      update: { appCode: "SUPPORT", menuName: m.name, menuType: "REPORT", reportId: m.reportId, isActive: true },
      create: {
        appCode: "SUPPORT",
        menuCode: m.code,
        parentMenuCode: "SUPPORT_ROOT",
        menuName: m.name,
        icon: "📊",
        menuType: "REPORT",
        reportId: m.reportId,
        level: 2,
        displayOrder: m.order,
        companyCode: "SIHL",
        hierarchyCode: "9999",
        isActive: true,
      },
    });

    for (const [roleCode, hierarchies] of [
      ["SUPPORT_DESK", STAFF_HIERARCHIES],
      ["SUPPORT_LEAD", STAFF_HIERARCHIES],
      ["PRODUCT_OPS", STAFF_HIERARCHIES],
      ["ADMIN", ["9999"]],
    ] as const) {
      for (const hierarchyCode of hierarchies) {
        await prisma.roleMenuMap.upsert({
          where: {
            roleCode_menuCode_companyCode_hierarchyCode: {
              roleCode,
              menuCode: m.code,
              companyCode: "SIHL",
              hierarchyCode,
            },
          },
          update: { isActive: true },
          create: { roleCode, menuCode: m.code, companyCode: "SIHL", hierarchyCode, isActive: true },
        });
      }
    }
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
