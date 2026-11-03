FROM postgres:18-alpine
RUN apk add --no-cache nodejs npm
WORKDIR /backup
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY backup.mjs ./
USER postgres
CMD ["node", "backup.mjs"]
