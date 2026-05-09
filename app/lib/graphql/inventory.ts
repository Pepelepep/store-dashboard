export const INVENTORY_QUERY = `#graphql
  query getInventoryLevels($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
      }
      edges {
        cursor
        node {
          id
          title
          variants(first: 100) {
            edges {
              node {
                id
                sku
                inventoryItem {
                  id
                  sku
                  tracked
                  createdAt
                  updatedAt
                  requiresShipping
                  inventoryLevels(first: 5) {
                    edges {
                      node {
                        quantities(names: ["available"]) {
                          name
                          quantity
                          updatedAt
                        }
                        location {
                          id
                          name
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;