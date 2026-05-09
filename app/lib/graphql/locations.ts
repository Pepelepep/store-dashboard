export const LOCATIONS_QUERY = `#graphql
  query getLocations($cursor: String) {
    locations(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
      }
      edges {
        cursor
        node {
          id
          name
          isActive
          address {
            address1
            city
            province
            country
          }
        }
      }
    }
  }
`;