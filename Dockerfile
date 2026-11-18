FROM node:24-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src

# Score files, issued-ticket records, output files and logs. Mount a folder here to keep them.
ENV DATA_DIR=/data
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node

ENTRYPOINT ["node", "src/cli.ts"]
CMD ["run"]
