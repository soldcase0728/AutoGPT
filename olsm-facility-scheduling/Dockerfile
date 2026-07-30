# ---------------------------------------------------------------------------
# OLSM Facility Scheduling
#
# There is deliberately no `# syntax=` directive. That line makes BuildKit pull
# an extra frontend image from Docker Hub before it reads anything else, which
# is one more thing to fail on a school network. Nothing below needs it -- the
# builtin frontend handles multi-stage COPY --from, --chown and HEALTHCHECK.
#
# Three stages so the runtime image carries no build toolchain and no source:
#   deps    node_modules from the committed lockfile
#   build   Prisma client + Next standalone output + bundled seed scripts
#   runner  the standalone server and what it needs to migrate on boot
#
# Base image is Debian slim rather than Alpine. Prisma ships prebuilt query and
# schema engines per platform, and the glibc builds are the best-tested ones --
# on Alpine (musl) an engine mismatch shows up as a confusing runtime error.
# The image is bigger; it is far more likely to work on the first try, on both
# Intel and Apple Silicon.
# ---------------------------------------------------------------------------

FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund


FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# `npm run build` runs prisma generate, next build, then bundles the seed
# scripts to plain JS.
RUN npm run build


FROM node:22-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Never run the app as root.
RUN groupadd -g 1001 nodejs && useradd -m -u 1001 -g nodejs nextjs

# The standalone bundle: server.js plus the modules the server imports.
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

# How the cron service calls a scheduled job. It uses node's built-in fetch
# because this image has neither wget nor curl.
COPY --chown=nextjs:nodejs docker/run-job.mjs ./run-job.mjs

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini reaps zombies and forwards signals, so the container stops cleanly.
ENTRYPOINT ["/usr/bin/tini", "--", "./entrypoint.sh"]
CMD ["node", "server.js"]
