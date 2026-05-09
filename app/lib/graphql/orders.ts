export const ORDERS_QUERY = `#graphql
  query getOrders($cursor: String) {
    orders(first: 100, after: $cursor) {
      pageInfo {
        hasNextPage
      }
      edges {
        cursor
        node {
          name
          id
          createdAt
          displayFinancialStatus
          fulfillments(first: 5) {
            location {
              id
              name
            }
          }
          lineItems(first: 100) {
            edges {
              node {
                id
                quantity
                variant {
                  id
                  sku
                }
                discountedUnitPriceSet {
                  shopMoney {
                    amount
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