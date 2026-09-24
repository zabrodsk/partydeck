FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server ./server
COPY public ./public
COPY scripts/container-entrypoint.sh /app/container-entrypoint.sh
RUN mkdir -p /app/data && chown -R node:node /app/data
ENV NODE_ENV=production PORT=3000 DATA_PATH=/app/data/table.sqlite
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["sh", "/app/container-entrypoint.sh"]
CMD ["node", "server/index.js"]
