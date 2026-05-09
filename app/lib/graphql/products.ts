export const PRODUCTS_QUERY = `#graphql
  query getProductsAndVariants($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
      }
      edges {
        cursor
        node {
          id
          title
          vendor
          productType
          updatedAt
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                price
                updatedAt
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      }
    }
  }
`;