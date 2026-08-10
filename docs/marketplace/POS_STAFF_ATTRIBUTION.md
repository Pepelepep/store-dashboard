# POS Staff Attribution

ShopOps Studio can attribute POS order lines from the active Shopify POS session without requiring POS sellers to have ShopOps dashboard access.

To enable Sales by Staff for POS, the merchant must add the **ShopOps POS attribution** tile to every Shopify POS Smart Grid template used by locations where attribution should run. One shared template can cover several locations; locations using different templates must each receive a configured template. The tile runs passively in the background and stamps cart line item properties from the current POS session. It does not ask the cashier to select a seller.

Setup path: **Shopify Admin > Point of Sale > Settings > POS app > Smart Grid >
select template > Add tile > Embedded Apps > ShopOps > Save**. Confirm that the
template is assigned to the intended location, then refresh Shopify POS and
verify that the ShopOps tile appears.

The public marketplace app does not request `read_users`, and POS sellers do not need to be added to Team Access for attribution to work.
