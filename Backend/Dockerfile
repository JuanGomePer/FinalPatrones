FROM node:18-alpine

# Set working directory inside the container
WORKDIR /app

# Copy ONLY backend package files
COPY package.json package-lock.json ./

# Install dependencies (prod only)
RUN npm ci --omit=dev

# Copy the backend source code
COPY . .

# Set environment
ENV NODE_ENV=production

# Expose ports used by API and WS (optional)
EXPOSE 3000 4000

# Default command (overridden by docker-compose)
CMD ["node", "src/api/index.js"]
