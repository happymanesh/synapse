import { z } from "zod";

/**
 * A blank select (rendered as value="") must mean "no value" for any field that's a
 * foreign key — Prisma will otherwise write the literal empty string into the FK
 * column, which violates the constraint (no row has id "") and surfaces as an opaque
 * 500 instead of the validation error it actually is.
 */
const optionalStringSchema = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().nullable());

const ipOctet = /^(\d{1,3}|\*)$/;
const ipPattern = z
  .string()
  .refine(
    (v) => v.split(".").length === 4 && v.split(".").every((part) => ipOctet.test(part)),
    { error: "Must be a dotted IP pattern, e.g. 192.168.1.10 or 192.168.*.*" }
  );

export const companySchema = z.object({
  companyCode: z.string().min(1).max(20),
  companyName: z.string().min(1),
  isActive: z.boolean(),
  panNo: z.string().optional().nullable(),
  tanNo: z.string().optional().nullable(),
  regdOfficeAddress: z.string().optional().nullable(),
  companyLogoFileLocation: z.string().optional().nullable(),
});
export const companyUpdateSchema = companySchema.omit({ companyCode: true });

export const hierarchySchema = z.object({
  hierarchyCode: z.string().min(1).max(10),
  hierarchyName: z.string().min(1),
  description: z.string().optional().nullable(),
  seqId: z.string().min(1).max(10),
  isActive: z.boolean(),
});
export const hierarchyUpdateSchema = hierarchySchema.omit({ hierarchyCode: true });

export const clientCategorySchema = z.object({
  clientCategoryCode: z.string().min(1).max(10),
  clientCategoryName: z.string().min(1),
  isActive: z.boolean(),
});
export const clientCategoryUpdateSchema = clientCategorySchema.omit({ clientCategoryCode: true });

export const ipMappingSchema = z.object({
  userUid: z.coerce.number().int(),
  ipMapping: ipPattern,
  isActive: z.boolean(),
});
export const ipMappingUpdateSchema = ipMappingSchema;

export const appSchema = z.object({
  appCode: z.string().min(1).max(30),
  appName: z.string().min(1),
  companyCode: z.string().min(1),
  description: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
  appLogoUrl: z.string().optional().nullable(),
  displayOrder: z.coerce.number().int(),
  isActive: z.boolean(),
});
export const appUpdateSchema = appSchema.omit({ appCode: true });

export const menuSchema = z.object({
  menuCode: z.string().min(1).max(30),
  parentMenuCode: optionalStringSchema,
  menuName: z.string().min(1),
  icon: z.string().optional().nullable(),
  routePath: z.string().optional().nullable(),
  level: z.coerce.number().int().min(1).max(3),
  displayOrder: z.coerce.number().int(),
  companyCode: z.string().min(1),
  hierarchyCode: z.string().min(1),
  menuType: z.enum(["ROUTE", "REPORT", "EXTERNAL"]).default("ROUTE"),
  externalUrl: z.string().optional().nullable(),
  reportId: optionalStringSchema,
  appCode: optionalStringSchema,
  isActive: z.boolean(),
});
export const menuUpdateSchema = menuSchema.omit({ menuCode: true });

export const roleSchema = z.object({
  roleCode: z.string().min(1).max(30),
  roleName: z.string().min(1),
  companyCode: z.string().min(1),
  hierarchyCode: z.string().min(1),
  isActive: z.boolean(),
});
export const roleUpdateSchema = roleSchema.omit({ roleCode: true });

export const userCreateSchema = z.object({
  companyCode: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  customerId: z.string().optional().nullable(),
  fullName: z.string().min(1),
  mobile: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  hierarchyCode: z.string().min(1),
  clientCategoryCode: z.string().min(1).default("C00"),
  isActive: z.boolean(),
});
export const userUpdateSchema = userCreateSchema.omit({ password: true });

export const passwordResetSchema = z.object({
  password: z.string().min(1),
});

export const codesSchema = z.object({
  codes: z.array(z.string()),
});

const optionalIdSchema = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().int().nullable());

export const filterComponentSchema = z.object({
  componentCode: z.string().min(1).max(40),
  componentName: z.string().min(1),
  componentType: z.enum(["TEXT", "NUMBER", "DATE", "DATE_RANGE", "DROPDOWN", "MULTI_SELECT", "CHECKBOX", "RADIO"]),
  dataSourceType: z.enum(["NONE", "STATIC", "SQL"]).default("NONE"),
  staticOptionsJson: z.string().optional().nullable(),
  dataSourceQuery: z.string().optional().nullable(),
  isActive: z.boolean(),
});
export const filterComponentUpdateSchema = filterComponentSchema.omit({ componentCode: true });

export const filterDefinitionSchema = z.object({
  filterId: z.string().min(1).max(40),
  filterName: z.string().min(1),
  isCollapsible: z.boolean(),
  defaultCollapsed: z.boolean(),
  isActive: z.boolean(),
});
export const filterDefinitionUpdateSchema = filterDefinitionSchema.omit({ filterId: true });

export const filterDefinitionItemSchema = z.object({
  componentCode: z.string().min(1),
  rowNo: z.coerce.number().int().min(1),
  positionNo: z.coerce.number().int().min(1),
  isMandatory: z.boolean(),
  labelOverride: z.string().optional().nullable(),
  defaultValue: z.string().optional().nullable(),
  mappedColumn: z.string().optional().nullable(),
  dependsOnItemId: optionalIdSchema,
  isActive: z.boolean(),
});
export const filterDefinitionItemUpdateSchema = filterDefinitionItemSchema;

export const reportDefinitionSchema = z.object({
  reportId: z.string().min(1).max(40),
  reportTitle: z.string().min(1),
  filterId: z.string().min(1),
  mode: z.enum(["REPORT", "FORM"]).default("REPORT"),
  queryText: z.string().min(1),
  targetTable: z.string().optional().nullable(),
  maxRows: z.coerce.number().int().min(1).default(2000),
  freezeColumns: z.coerce.number().int().min(0).default(0),
  displayStyle: z.enum(["PAGED", "FULL_FROZEN"]).default("PAGED"),
  footerNote: z.string().optional().nullable(),
  allowedFormats: z
    .string()
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
    .or(z.array(z.string())),
  allowedDeliveries: z
    .string()
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
    .or(z.array(z.string())),
  isActive: z.boolean(),
});
export const reportDefinitionUpdateSchema = reportDefinitionSchema.omit({ reportId: true });

export const reportColumnSchema = z.object({
  columnKey: z.string().min(1),
  displayLabel: z.string().min(1),
  displayOrder: z.coerce.number().int().default(0),
  isHighlighted: z.boolean(),
  isIdentifier: z.boolean(),
  dataType: z.enum(["TEXT", "NUMBER", "DATE", "DATETIME"]).default("TEXT"),
  decimalPlaces: optionalIdSchema,
  showTotal: z.boolean().default(false),
  drillDownReportId: optionalStringSchema,
  drillDownTargetParam: optionalStringSchema,
  drillDownMode: z.enum(["PAGE", "MODAL"]).default("PAGE"),
  drillDownModalSize: z.enum(["AUTO", "SMALL", "MEDIUM", "LARGE"]).default("AUTO"),
});
export const reportColumnUpdateSchema = reportColumnSchema;

export const reportRowHighlightRuleSchema = z.object({
  columnKey: z.string().min(1),
  operator: z.enum(["EQ", "NEQ", "GT", "LT", "GTE", "LTE", "CONTAINS"]),
  compareValue: z.string().min(1),
  highlightColor: z.string().min(1),
  priority: z.coerce.number().int().default(0),
});
export const reportRowHighlightRuleUpdateSchema = reportRowHighlightRuleSchema;

const optionalDateSchema = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.date().nullable());

export const notificationSchema = z.object({
  targetType: z.enum(["HIERARCHY", "USER"]),
  targetHierarchyCode: optionalStringSchema,
  targetUserUid: optionalIdSchema,
  deliveryPopup: z.boolean().default(false),
  deliveryBell: z.boolean().default(true),
  messageText: z.string().min(1),
  scheduledFor: optionalDateSchema,
  isActive: z.boolean().default(true),
});
export const notificationUpdateSchema = notificationSchema;
