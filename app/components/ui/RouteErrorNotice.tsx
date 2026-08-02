import { isRouteErrorResponse, useRouteError } from "react-router";

import { PageNotice } from "./PageNotice";

function getRouteErrorCopy(error: unknown) {
  if (isRouteErrorResponse(error)) {
    if (error.status === 403 && error.data === "ShopOps access required.") {
      return {
        title: "ShopOps access required",
        message:
          "Contact the store owner to request ShopOps access for your email address.",
        bullets: [
          "After the owner grants access, reopen ShopOps Studio from Shopify admin.",
        ],
        tone: "warning" as const,
      };
    }

    if (
      error.status === 403 &&
      error.data ===
        "Your ShopOps access needs to be updated by the store owner."
    ) {
      return {
        title: "Plan access update required",
        message:
          "The store owner needs to resolve the current plan limits before this report is available.",
        bullets: ["Contact the store owner to update ShopOps access."],
        tone: "warning" as const,
      };
    }

    if (
      error.status === 403 &&
      error.data === "Forbidden: no location access configured"
    ) {
      return {
        title: "Location access denied",
        message:
          "Your ShopOps user does not have access to a selected reporting location.",
        bullets: ["Ask the store owner to update your assigned locations."],
        tone: "warning" as const,
      };
    }

    if (
      error.status === 503 &&
      typeof error.data === "string" &&
      error.data.startsWith("Shopify authentication is required")
    ) {
      return {
        title: "Reconnect ShopOps Studio",
        message:
          "Reopen ShopOps Studio from Shopify admin so the store connection can be restored.",
        bullets: undefined,
        tone: "warning" as const,
      };
    }

    if (error.status === 401 || error.status === 403) {
      return {
        title: "You do not have access to this page",
        message: "This page is available to app admins only.",
        bullets: ["Ask a ShopOps Studio admin to update your permissions."],
        tone: "warning" as const,
      };
    }

    if (error.status === 404) {
      return {
        title: "Page not found",
        message:
          "The page you are looking for does not exist or is no longer available.",
        bullets: undefined,
        tone: "neutral" as const,
      };
    }
  }

  return {
    title: "Something went wrong",
    message:
      "Please refresh the page or contact support if the issue continues.",
    bullets: undefined,
    tone: "critical" as const,
  };
}

export function RouteErrorNotice() {
  const error = useRouteError();
  const copy = getRouteErrorCopy(error);

  return (
    <main
      style={{
        background: "#f6f6f7",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <PageNotice
        title={copy.title}
        message={copy.message}
        bullets={copy.bullets}
        tone={copy.tone}
        style={{ margin: "0 auto", maxWidth: 920 }}
      />
    </main>
  );
}
