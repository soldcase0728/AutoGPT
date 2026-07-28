# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# OLSM Facility Scheduling
#
# Three stages so the runtime image carries no build toolchain and no source:
#   deps    node_modules from the committed lockfile
#   build   Prisma client + Next standalone output
#   runner  the standalone server, the Prisma CLI needed to migrate on boot,
#           and nothing else
# ---------------------------------------------------------------------------

FROM node:22-alpine AS deps
WORKDIR /app
# openssl is a Prisma engine dependency on Alpine.
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund


FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# `npm run build` runs `prisma generate` first.
RUN npm run build


FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl tini

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Never run the app as root.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# The standalone bundle: server.js plus the modules it actually imports.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# The schema and migration SQL, applied on boot by the entrypoint.
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma

# The seed and demo-data scripts are bundled to plain JS at build time, so the
# runtime never has to compile TypeScript and carries no toolchain to do it.
COPY --from=build --chown=nextjs:nodejs /app/dist-scripts ./dist-scripts

# The full dependency tree, laid over the standalone bundle's own copy.
#
# The standalone output contains only what the *server* imports, which is not
# enough to run `prisma migrate deploy`: the CLI pulls in a long tail of
# transitive dependencies, and hand-picking them is a guessing game that breaks
# on the next Prisma upgrade. Trading image size for a migration step that
# actually works is the right way round for a pilot. If image size starts to
# matter, move migrations to a release step rather than trimming this.
COPY --from=build --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nextjs:nodejs /app/package.json ./package.json

COPY --chown=nextjs:nodejs docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini reaps zombies and forwards signals, so the container stops cleanly.
ENTRYPOINT ["/sbin/tini", "--", "./entrypoint.sh"]
CMD ["node", "server.js"]
