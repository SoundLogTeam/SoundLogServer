import fs from 'node:fs';
import path from 'node:path';

import type { Express, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';

const OPENAPI_SPEC_PATH = path.resolve(process.cwd(), 'openapi/soundlog-api.yaml');
const OPENAPI_SPEC_ROUTE = '/openapi.yaml';
const SWAGGER_DOCS_ROUTE = '/docs';

function readOpenApiSpec() {
  return fs.readFileSync(OPENAPI_SPEC_PATH, 'utf8');
}

export function registerSwaggerDocs(app: Express) {
  app.get(OPENAPI_SPEC_ROUTE, (_req: Request, res: Response) => {
    res.type('application/yaml').send(readOpenApiSpec());
  });

  app.get('/swagger', (_req: Request, res: Response) => {
    res.redirect(SWAGGER_DOCS_ROUTE);
  });

  app.use(
    SWAGGER_DOCS_ROUTE,
    swaggerUi.serve,
    swaggerUi.setup(null, {
      customSiteTitle: 'Soundlog API Docs',
      swaggerOptions: {
        persistAuthorization: true,
        url: OPENAPI_SPEC_ROUTE,
      },
    }),
  );
}
