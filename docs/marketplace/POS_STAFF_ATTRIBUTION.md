# POS Staff Attribution

ShopOps Studio can attribute POS order lines from the active Shopify POS session without requiring POS sellers to have ShopOps dashboard access.

To enable Sales by Staff for POS, the merchant must add the **ShopOps POS attribution** tile to the Shopify POS Smart Grid for each POS template/location. The tile runs passively in the background and stamps cart line item properties from the current POS session. It does not ask the cashier to select a seller.

The public marketplace app does not request `read_users`, and POS sellers do not need to be added to Team Access for attribution to work.
