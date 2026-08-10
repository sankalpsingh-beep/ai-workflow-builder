import { GraphQLClient } from 'graphql-request';

export function getAdminClient(): GraphQLClient {
  const hasuraUrl = process.env.NHOST_GRAPHQL_URL || 'http://localhost:1337/v1/graphql';
  const adminSecret = process.env.NHOST_ADMIN_SECRET || 'nhost-admin-secret';
  
  return new GraphQLClient(hasuraUrl, {
    headers: {
      'x-hasura-admin-secret': adminSecret,
    },
  });
}

export function getUserClient(userId: string, orgIds: string[]): GraphQLClient {
  const hasuraUrl = process.env.NHOST_GRAPHQL_URL || 'http://localhost:1337/v1/graphql';
  
  return new GraphQLClient(hasuraUrl, {
    headers: {
      'x-hasura-user-id': userId,
      'x-hasura-role': 'user',
      'x-hasura-allowed-orgs': `{${orgIds.join(',')}}`,
    },
  });
}
