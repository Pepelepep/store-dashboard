type SessionDeleteClient = {
  session: {
    deleteMany: (args: {
      where: { shop: string };
    }) => Promise<{ count: number }>;
  };
};

export async function deleteShopifySessionsForUninstalledShop({
  db,
  shop,
}: {
  db: SessionDeleteClient;
  shop: string;
}) {
  if (!shop) {
    throw new Error("Missing shop domain for session cleanup.");
  }

  return db.session.deleteMany({ where: { shop } });
}
