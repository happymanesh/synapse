import type { Metadata } from "next";
import Image from "next/image";
import { prisma } from "@/lib/db";
import LoginPanel from "./LoginPanel";

export const metadata: Metadata = {
  title: "Login | SIHL Synapse",
};

export default async function LoginPage() {
  const company = await prisma.companyMaster.findUnique({
    where: { companyCode: "SIHL" },
    select: { companyName: true, companyLogoFileLocation: true },
  });

  return (
    <div className="flex min-h-screen w-full flex-col md:flex-row">
      <div
        className="relative flex flex-1 flex-col justify-between overflow-hidden p-10 text-white md:min-h-screen"
        style={{ backgroundImage: "linear-gradient(135deg, #0a3d6b 0%, #0d2744 60%, #081a2f 100%)" }}
      >
        <div className="relative z-10 flex items-center gap-3">
          {company?.companyLogoFileLocation && (
            <div className="rounded-xl bg-white p-2 shadow-lg">
              <Image
                src={company.companyLogoFileLocation}
                alt={company.companyName ?? "SIHL"}
                width={44}
                height={44}
                className="object-contain"
                priority
              />
            </div>
          )}
          <span className="text-sm font-semibold tracking-[0.2em] text-white/70 uppercase">
            {company?.companyName ?? "SIHL"}
          </span>
        </div>
        <div className="relative z-10 max-w-md">
          <h1 className="text-4xl font-extrabold tracking-tight text-white">Synapse</h1>
          <p className="mt-4 text-lg text-white/85">One login for your business needs.</p>
          <p className="mt-2 text-sm text-white/60">
            A unified access platform for SIHL&apos;s Employees, Branches, Management,
            Franchisees, and Remisiers.
          </p>
        </div>
        <div className="relative z-10 text-xs text-white/50">
          &copy; {new Date().getFullYear()} {company?.companyName ?? "Shah Investor's Home Limited"}
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center bg-background p-8 md:min-h-screen">
        <LoginPanel />
      </div>
    </div>
  );
}
