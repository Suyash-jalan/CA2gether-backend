FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p uploads private_uploads logs

EXPOSE 5000
CMD ["node", "server.js"]
