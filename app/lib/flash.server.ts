import { createCookieSessionStorage } from "react-router";

function getFlashStorage() {
  const secret = process.env.SESSION_SECRET ?? process.env.SHOPIFY_API_SECRET;
  if (!secret)
    throw new Error("A session secret is required for flash messages.");

  return createCookieSessionStorage<{ planConfirmed: string }>({
    cookie: {
      name: "shopops_flash",
      httpOnly: true,
      maxAge: 300,
      path: "/app",
      sameSite: "lax",
      secrets: [secret],
      secure: process.env.NODE_ENV === "production",
    },
  });
}

export async function setPlanConfirmedFlash(request: Request) {
  const storage = getFlashStorage();
  const session = await storage.getSession(request.headers.get("Cookie"));
  session.flash("planConfirmed", "Plan confirmed.");
  return storage.commitSession(session);
}

export async function consumePlanConfirmedFlash(request: Request) {
  const storage = getFlashStorage();
  const session = await storage.getSession(request.headers.get("Cookie"));
  const message = session.get("planConfirmed") ?? null;
  if (!message) return { message: null, setCookie: null };
  return {
    message,
    setCookie: await storage.commitSession(session),
  };
}
