import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import "@shopify/polaris/build/esm/styles.css";

export default function App() {
  return (
    <html>
      <head>
        <Meta />
        <Links />
      </head>

      <body>
        <PolarisAppProvider i18n={polarisTranslations}>
          <Outlet />
        </PolarisAppProvider>

        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}