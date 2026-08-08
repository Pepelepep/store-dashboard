import '@shopify/ui-extensions';

// @ts-expect-error Shopify generates this declaration for the JSX extension entrypoint.
declare module './src/Tile.jsx' {
  const shopify: import('@shopify/ui-extensions/pos.home.tile.render').Api;
  const globalThis: { shopify: typeof shopify };
}

// @ts-expect-error Shopify generates this declaration for the JSX extension entrypoint.
declare module './src/Modal.jsx' {
  const shopify: import('@shopify/ui-extensions/pos.home.modal.render').Api;
  const globalThis: { shopify: typeof shopify };
}
