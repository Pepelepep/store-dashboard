import { isRouteErrorResponse, useRouteError } from "react-router";

import { PageNotice } from "./PageNotice";

function getRouteErrorCopy(error: unknown) {
  if (isRouteErrorResponse(error)) {
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
    message: "Please refresh the page or contact support if the issue continues.",
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
