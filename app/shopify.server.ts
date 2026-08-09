import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { RequestedTokenType, shopifyApi } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const appConfig = {
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  useOnlineTokens: true,
  // The Shopify adapter and generated Prisma client expose incompatible
  // generic versions even though this is the adapter's required runtime shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessionStorage: new PrismaSessionStorage(prisma) as any,
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
};

const shopify = shopifyApp(appConfig);
const tokenExchangeApi = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY ?? "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET ?? "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(",") ?? [],
  hostName: new URL(
    process.env.SHOPIFY_APP_URL ?? "https://invalid.shopops.local",
  ).host,
  isEmbeddedApp: true,
});

export async function acquireOfflineSession({
  shop,
  sessionToken,
}: {
  shop: string;
  sessionToken: string;
}) {
  const { session } = await tokenExchangeApi.auth.tokenExchange({
    shop,
    sessionToken,
    requestedTokenType: RequestedTokenType.OfflineAccessToken,
    expiring: true,
  });
  await shopify.sessionStorage!.storeSession(session);
  return session;
}

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
