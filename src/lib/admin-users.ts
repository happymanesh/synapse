import { Prisma } from "../../generated/prisma/client";
import { prisma } from "@/lib/db";

export interface UsersPageParams {
  page: number;
  pageSize: number;
  company?: string;
  search?: string;
}

/** Shared by the server-rendered first page and the client's paged fetches, so both agree on shape. */
export async function getUsersPage({ page, pageSize, company, search }: UsersPageParams) {
  const where: Prisma.UserDetailsWhereInput = {
    ...(company ? { companyCode: company } : {}),
    ...(search
      ? {
          OR: [
            { username: { contains: search, mode: "insensitive" } },
            { fullName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { mobile: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.userDetails.findMany({
      where,
      orderBy: { username: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        userRoles: {
          where: { isActive: true, role: { isActive: true } },
          include: { role: true },
        },
        hierarchy: { select: { hierarchyName: true } },
        clientCategory: { select: { clientCategoryName: true } },
      },
    }),
    prisma.userDetails.count({ where }),
  ]);

  // The raw *Code fields stay on the row: the table displays the friendly names, but the
  // edit form's selects are keyed by code and would come up blank without them.
  const rows = users.map((u) => {
    const { userRoles, hierarchy, clientCategory, ...rest } = u;
    return {
      ...rest,
      hierarchyName: hierarchy.hierarchyName,
      clientCategoryName: clientCategory.clientCategoryName,
      roles: userRoles.map((ur) => ur.role.roleName).join(", ") || "—",
    };
  });

  return { rows, total };
}
