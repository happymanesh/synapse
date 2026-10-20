import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import ForcedPasswordChange from "./ForcedPasswordChange";

/**
 * First-login password change. The proxy sends a session carrying the mustChangePassword
 * claim here from every other page, and refuses its API calls, until the password is changed.
 * Outside the (app) group on purpose: the app shell would load menus and data this user may
 * not see yet.
 */
export default async function ChangePasswordPage() {
  const session = await getSession({ allowPendingPasswordChange: true });
  if (!session) redirect("/login");
  if (!session.mustChangePassword) redirect("/dashboard");
  return <ForcedPasswordChange />;
}
