import { defineConfig } from 'orval';

export default defineConfig({
  reportist: {
    input: '../backend/openapi.json',
    output: {
      mode: 'tags-split',
      target: './src/api/generated/endpoints.ts',
      schemas: './src/api/generated/models',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      override: {
        mutator: {
          path: './src/api/fetcher.ts',
          name: 'customFetch',
        },
        query: {
          useQuery: true,
          signal: true,
        },
      },
    },
  },
});
