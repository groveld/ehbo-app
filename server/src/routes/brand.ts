// Eigen logo's en het webmanifest, voor iedereen. Zonder eigen icoon verwijzen de adressen naar het standaardicoon.
import type { FastifyInstance } from 'fastify';
import { BRAND_IMAGES, buildManifest, getBrandImage, type BrandImage } from '../brand.ts';
import type { EventDb } from '../event-db.ts';

export async function brandRoutes(app: FastifyInstance, { db }: { db: EventDb }) {
  // Vaste adressen (ook in index.html en de service worker); daarom steeds even navragen of er iets nieuws is.
  app.get<{ Params: { name: string } }>('/brand/:name', async (request, reply) => {
    const name = request.params.name.replace(/\.png$/, '');
    if (!Object.hasOwn(BRAND_IMAGES, name)) return reply.code(404).send({ error: 'Niet gevonden' });
    const image = BRAND_IMAGES[name as BrandImage];
    reply.header('Cache-Control', 'no-cache');
    const data = getBrandImage(db, name as BrandImage);
    if (!data) return image.fallback ? reply.redirect(image.fallback, 302) : reply.code(404).send({ error: 'Geen logo' });
    return reply.type('image/png').send(Buffer.from(data));
  });

  app.get('/manifest.webmanifest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-cache').type('application/manifest+json');
    return JSON.stringify(buildManifest(db));
  });
}
