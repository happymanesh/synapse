import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import AdminCrudTable, { type FieldConfig, type ColumnConfig } from "@/components/admin/AdminCrudTable";
import { resolveHierarchy } from "@/lib/hr/lifecycle/lifecycle-core";

/**
 * Administration > HR Mapping: which Synapse company + hierarchy new joiners from each HR
 * branch/department get. Never inferred (menu grants are hierarchy-filtered, so a guess would
 * silently change what someone can see): an unmapped combination's joiners are simply not added
 * until a row exists here. A blank department = any department in that branch.
 */
export default async function HrMappingPage() {
  const [rows, companies, hierarchies, hr, session] = await Promise.all([
    prisma.hrBranchHierarchyMap.findMany({ orderBy: [{ hrCompanyCode: "asc" }, { hrBranch: "asc" }, { hrDepartment: "asc" }] }),
    prisma.companyMaster.findMany({ select: { companyCode: true, companyName: true }, orderBy: { companyCode: "asc" } }),
    prisma.hierarchyMaster.findMany({ select: { hierarchyCode: true, hierarchyName: true }, orderBy: { seqId: "asc" } }),
    prisma.hrEmployee.findMany({
      where: { employmentStatus: "ACTIVE" },
      select: { sourceCompanyCode: true, branch: true, department: true, user: { select: { uid: true } } },
    }),
    getSession(),
  ]);

  const distinct = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  const opt = (xs: string[]) => xs.map((x) => ({ value: x, label: x }));

  // Active employees without a login whose combination has no mapping: what to map next.
  const unmapped = new Map<string, { company: string; branch: string; department: string; count: number }>();
  for (const e of hr) {
    if (e.user) continue;
    if (resolveHierarchy(e, rows).kind === "MAPPED") continue;
    const key = [e.sourceCompanyCode, e.branch, e.department].join("|");
    const cur = unmapped.get(key) ?? { company: e.sourceCompanyCode ?? "—", branch: e.branch ?? "—", department: e.department ?? "—", count: 0 };
    cur.count++;
    unmapped.set(key, cur);
  }
  const todo = [...unmapped.values()].sort((a, b) => b.count - a.count || a.branch.localeCompare(b.branch));

  const fields: FieldConfig[] = [
    { name: "hrCompanyCode", label: "HR Company", type: "select", required: true, options: opt(distinct(hr.map((e) => e.sourceCompanyCode))) },
    { name: "hrBranch", label: "HR Branch", type: "select", required: true, options: opt(distinct(hr.map((e) => e.branch))) },
    {
      name: "hrDepartment",
      label: "HR Department (blank = any)",
      type: "select",
      options: [{ value: "", label: "(any department)" }, ...opt(distinct(hr.map((e) => e.department)))],
    },
    { name: "companyCode", label: "Synapse Company", type: "select", required: true, options: companies.map((c) => ({ value: c.companyCode, label: c.companyName })) },
    { name: "hierarchyCode", label: "Synapse Hierarchy", type: "select", required: true, options: hierarchies.map((h) => ({ value: h.hierarchyCode, label: h.hierarchyName })) },
    { name: "isActive", label: "Active", type: "checkbox", defaultValue: true },
  ];

  const columns: ColumnConfig[] = [
    { key: "hrCompanyCode", label: "HR Company" },
    { key: "hrBranch", label: "HR Branch" },
    // Plain columns: this is a server component, and functions cannot cross to AdminCrudTable.
    { key: "hrDepartment", label: "HR Department (blank = any)" },
    { key: "companyCode", label: "Company" },
    { key: "hierarchyCode", label: "Hierarchy" },
    { key: "isActive", label: "Active" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold text-foreground">HR Mapping</h1>
        <p className="mb-4 text-sm text-foreground/60">
          Where new employees from each HR branch/department are placed in Synapse. Employees in a combination
          with no mapping are not added by HR Sync. A specific department wins over “(any department)”.
        </p>
        <AdminCrudTable
          apiBasePath="/api/admin/hr-mapping"
          idField="id"
          columns={columns}
          fields={fields}
          initialData={rows}
          currentUsername={session!.username}
          compactActions
        />
      </div>

      <section>
        <h2 className="mb-2 text-base font-semibold text-foreground">
          Not yet mapped — {todo.reduce((n, t) => n + t.count, 0)} active employee(s) without a login in {todo.length} combination(s)
        </h2>
        {todo.length === 0 ? (
          <p className="text-sm text-foreground/60">Every active employee without a login has a mapping.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-foreground/60">
                <tr>
                  <th className="px-3 py-2">HR Company</th>
                  <th className="px-3 py-2">HR Branch</th>
                  <th className="px-3 py-2">HR Department</th>
                  <th className="px-3 py-2 text-right">Employees</th>
                </tr>
              </thead>
              <tbody>
                {todo.map((t) => (
                  <tr key={`${t.company}|${t.branch}|${t.department}`} className="border-t border-border">
                    <td className="px-3 py-2">{t.company}</td>
                    <td className="px-3 py-2">{t.branch}</td>
                    <td className="px-3 py-2">{t.department}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
