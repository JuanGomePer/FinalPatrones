FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production
COPY . .
ENV NODE_ENV=production
EXPOSE 3000 4000
CMD ["node", "src/api/index.js"]
