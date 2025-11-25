# Stage 1: build
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install

# Copy source files
COPY . .

# Build Vite app
RUN npm run build

# Stage 2: serve
FROM nginx:alpine

# Copy built files to nginx html folder
COPY --from=build /app/dist /usr/share/nginx/html

# Copy custom nginx config if needed
# COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 5173 (or 80 for nginx)
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
