import { NhostClient } from '@nhost/nextjs';

const nhost = new NhostClient({
  subdomain: process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'local',
  region: process.env.NEXT_PUBLIC_NHOST_REGION || '',
  // For local development
  ...(process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN === 'local' && {
    authUrl: 'http://localhost:1337/v1/auth',
    graphqlUrl: 'http://localhost:1337/v1/graphql',
    storageUrl: 'http://localhost:1337/v1/storage',
    functionsUrl: 'http://localhost:1337/v1/functions',
  }),
});

export { nhost };
