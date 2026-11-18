FROM node:24-alpine

WORKDIR /app

COPY dist/server.js ./dist/server.js

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/server.js"]
